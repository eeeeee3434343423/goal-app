(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SyncSafetyV2 = Object.freeze(api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var VALID_TYPES = { goal: true, hubApp: true };
  var ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function conflict(message) {
    var error = new Error(message || "The cloud record changed on another device.");
    error.code = "REVISION_CONFLICT";
    return error;
  }

  function validateCloudRecord(record, recordType) {
    var errors = [];
    if (!VALID_TYPES[recordType]) errors.push("unknown record type");
    if (!record || typeof record !== "object" || Array.isArray(record)) return { ok: false, errors: ["record must be an object"] };
    if (typeof record.id !== "string" || !ID_PATTERN.test(record.id)) errors.push("invalid id");
    if (!record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) errors.push("payload must be an object");
    if (record.schemaVersion !== 2) errors.push("schemaVersion must be 2");
    if (!Number.isSafeInteger(record.revision) || record.revision < 1) errors.push("revision must be a positive integer");
    if (Object.prototype.hasOwnProperty.call(record, "deletedAt")) errors.push("live records cannot contain deletedAt");
    return { ok: errors.length === 0, errors: errors };
  }

  function hashText(text) {
    var hash = 2166136261;
    for (var index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function canonicalJson(value) {
    if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
    if (value && typeof value === "object") {
      return "{" + Object.keys(value).sort().map(function (key) {
        return JSON.stringify(key) + ":" + canonicalJson(value[key]);
      }).join(",") + "}";
    }
    return JSON.stringify(value);
  }

  function stableId(item, recordType) {
    var candidate = item && (item.id || item.key || item.url);
    if (typeof candidate === "string" && ID_PATTERN.test(candidate)) return candidate;
    return recordType + "-" + hashText(canonicalJson(item));
  }

  function migrateLegacyEnvelopeOnce(legacyEnvelope, recordType) {
    if (!Array.isArray(legacyEnvelope)) return { records: [], skipped: 0, errors: ["legacy envelope must be an array"] };
    var used = Object.create(null);
    var records = legacyEnvelope.map(function (item, index) {
      var payload = item && typeof item === "object" && !Array.isArray(item) ? clone(item) : { value: item };
      var id = stableId(payload, recordType);
      var collision = 1;
      while (used[id]) {
        id = stableId(payload, recordType) + "-duplicate-" + collision;
        collision += 1;
      }
      used[id] = true;
      return { id: id, payload: payload, schemaVersion: 2, revision: 1 };
    });
    return { records: records, skipped: 0, errors: [] };
  }

  function computeDangerousChange(previousRecords, proposedRecords) {
    var previous = Array.isArray(previousRecords) ? previousRecords : [];
    var proposed = Array.isArray(proposedRecords) ? proposedRecords : [];
    var proposedIds = Object.create(null);
    proposed.forEach(function (record) { if (record && record.id != null) proposedIds[String(record.id)] = true; });
    var removedCount = previous.reduce(function (count, record) {
      return count + (record && proposedIds[String(record.id)] ? 0 : 1);
    }, 0);
    var removalRatio = previous.length ? removedCount / previous.length : 0;
    var dangerous = previous.length > 0 && (proposed.length === 0 || removedCount >= 3 || removalRatio >= 0.5);
    return {
      dangerous: dangerous,
      removedCount: removedCount,
      removalRatio: removalRatio,
      reason: dangerous ? "Blocked abnormal removal of " + removedCount + " of " + previous.length + " records." : ""
    };
  }

  function enterReadOnlySafetyMode(reason) {
    return { readOnly: true, reason: String(reason || "A destructive change was blocked.") };
  }

  function assertExpectedRevision(current, expectedRevision) {
    var actual = current && Number.isSafeInteger(current.revision) ? current.revision : 0;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== actual) throw conflict();
    return true;
  }

  function validateAppUrl(value) {
    try {
      var parsed = new URL(value);
      var ok = parsed.protocol === "https:" && Boolean(parsed.hostname);
      return { ok: ok, error: ok ? "" : "Only absolute HTTPS app URLs are allowed." };
    } catch (error) {
      return { ok: false, error: "Only absolute HTTPS app URLs are allowed." };
    }
  }

  function recordSize(value) {
    if (value == null) return 0;
    if (Array.isArray(value)) return value.length + value.reduce(function (sum, item) { return sum + recordSize(item); }, 0);
    if (typeof value === "object") return Object.keys(value).length + Object.keys(value).reduce(function (sum, key) { return sum + recordSize(value[key]); }, 0);
    return 1;
  }

  function snapshotWeight(snapshot) {
    return Object.keys(snapshot || {}).reduce(function (sum, key) {
      var value = snapshot[key];
      try { value = JSON.parse(value); } catch (error) {}
      return sum + 1 + recordSize(value);
    }, 0);
  }

  function computeSnapshotRisk(previousSnapshot, proposedSnapshot) {
    var priorWeight = snapshotWeight(previousSnapshot);
    var nextWeight = snapshotWeight(proposedSnapshot);
    var dangerous = priorWeight > 0 && (nextWeight === 0 || nextWeight / priorWeight < 0.5);
    return {
      dangerous: dangerous,
      previousWeight: priorWeight,
      proposedWeight: nextWeight,
      reason: dangerous ? "Blocked an abnormally small Life Systems snapshot." : ""
    };
  }

  function createMemoryRecordStore(initialRecords) {
    var records = Object.create(null);
    var trash = Object.create(null);
    var changeLog = [];
    (initialRecords || []).forEach(function (record) { records[record.id] = clone(record); });

    return {
      get: function (id) { return records[id] ? clone(records[id]) : null; },
      commit: function (mutation, expectedRevision) {
        var current = records[mutation.id] || null;
        assertExpectedRevision(current, expectedRevision);
        var next = {
          id: mutation.id,
          payload: clone(mutation.payload),
          schemaVersion: 2,
          revision: expectedRevision + 1
        };
        var validation = validateCloudRecord(next, mutation.recordType);
        if (!validation.ok) throw new TypeError(validation.errors.join("; "));
        records[next.id] = next;
        changeLog.push({ operation: current ? "update" : "create", recordType: mutation.recordType, recordId: next.id, beforeRevision: expectedRevision, afterRevision: next.revision });
        return clone(next);
      },
      moveToTrash: function (recordType, id, expectedRevision) {
        var current = records[id];
        if (!current) throw new Error("Record not found.");
        assertExpectedRevision(current, expectedRevision);
        var trashId = recordType + ":" + id;
        var entry = {
          id: trashId, recordType: recordType, recordId: id, payload: clone(current.payload),
          revision: current.revision, deletedAt: new Date().toISOString(),
          purgeAfter: new Date(Date.now() + 30 * 86400000).toISOString()
        };
        trash[trashId] = entry;
        delete records[id];
        changeLog.push({ operation: "delete", recordType: recordType, recordId: id, beforeRevision: current.revision, afterRevision: current.revision });
        return clone(entry);
      },
      restoreTrashRecord: function (trashId, expectedRevision) {
        var entry = trash[trashId];
        if (!entry) throw new Error("Trash record not found.");
        if (entry.revision !== expectedRevision || records[entry.recordId]) throw conflict();
        var restored = { id: entry.recordId, payload: clone(entry.payload), schemaVersion: 2, revision: entry.revision + 1 };
        records[restored.id] = restored;
        delete trash[trashId];
        changeLog.push({ operation: "restore", recordType: entry.recordType, recordId: restored.id, beforeRevision: entry.revision, afterRevision: restored.revision });
        return clone(restored);
      },
      snapshot: function () {
        return { records: Object.keys(records).map(function (id) { return clone(records[id]); }), trash: Object.keys(trash).map(function (id) { return clone(trash[id]); }), changeLog: clone(changeLog) };
      }
    };
  }

  function exportRecoveryBundle(state) {
    var bundle = {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      records: clone(state.records || []),
      trash: clone(state.trash || []),
      changeLog: clone(state.changeLog || []),
      legacy: clone(state.legacy || {})
    };
    return new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  }

  return {
    validateCloudRecord: validateCloudRecord,
    migrateLegacyEnvelopeOnce: migrateLegacyEnvelopeOnce,
    computeDangerousChange: computeDangerousChange,
    enterReadOnlySafetyMode: enterReadOnlySafetyMode,
    assertExpectedRevision: assertExpectedRevision,
    validateAppUrl: validateAppUrl,
    computeSnapshotRisk: computeSnapshotRisk,
    createMemoryRecordStore: createMemoryRecordStore,
    exportRecoveryBundle: exportRecoveryBundle
  };
});
