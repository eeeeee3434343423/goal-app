(function () {
  "use strict";
  var safety = window.SyncSafetyV2;
  var config = null;
  var cache = Object.create(null);
  var pending = Object.create(null);
  var readOnly = "";

  function requireConfig() {
    if (!config || !config.port) throw new Error("V2 Firestore is not configured.");
    if (readOnly) throw new Error(readOnly);
    return config;
  }
  function collectionFor(recordType) { return recordType === "goal" ? "goals" : "hubApps"; }
  function payloadEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function cacheRecords(collectionName, records) {
    cache[collectionName] = Object.create(null);
    records.forEach(function (record) { cache[collectionName][record.id] = record; });
  }

  window.configureV2Sync = async function (nextConfig) {
    if (!nextConfig || !nextConfig.uid || !nextConfig.deviceId || !nextConfig.port) throw new TypeError("Invalid v2 sync configuration.");
    config = nextConfig;
    readOnly = "";
    window.__V2_SYNC_ACTIVE = true;
    return true;
  };
  window.validateCloudRecord = function (record, recordType) { return safety.validateCloudRecord(record, recordType); };
  window.computeDangerousChange = function (before, after) { return safety.computeDangerousChange(before, after); };
  window.enterReadOnlySafetyMode = function (reason) {
    readOnly = String(reason || "Cloud writes are locked.");
    document.documentElement.setAttribute("data-sync-read-only", "true");
    return { readOnly: true, reason: readOnly };
  };
  window.loadV2Records = async function (collectionName) {
    var active = requireConfig();
    var records = await active.port.list(collectionName);
    var recordType = collectionName === "goals" ? "goal" : "hubApp";
    records.forEach(function (record) {
      var result = safety.validateCloudRecord(record, recordType);
      if (!result.ok) throw new TypeError("Invalid cloud record " + record.id + ": " + result.errors.join("; "));
    });
    cacheRecords(collectionName, records);
    return records;
  };
  window.commitRecordMutation = async function (mutation, expectedRevision) {
    var active = requireConfig();
    var collectionName = collectionFor(mutation.recordType);
    var pendingKey = collectionName + "/" + mutation.id;
    pending[pendingKey] = true;
    try {
      var result = await active.port.commit(collectionName, mutation, expectedRevision, active.deviceId);
      if (!cache[collectionName]) cache[collectionName] = Object.create(null);
      cache[collectionName][result.id] = result;
      return result;
    } finally {
      delete pending[pendingKey];
    }
  };
  window.syncV2Records = async function (collectionName, rawRecords, recordType) {
    requireConfig();
    var migrated = safety.migrateLegacyEnvelopeOnce(rawRecords, recordType).records;
    var existing = cache[collectionName] || Object.create(null);
    var risk = safety.computeDangerousChange(Object.keys(existing).map(function (id) { return existing[id]; }), migrated);
    if (risk.dangerous) {
      window.enterReadOnlySafetyMode(risk.reason);
      throw new Error(risk.reason);
    }
    var changed = migrated.filter(function (record) {
      return !existing[record.id] || !payloadEqual(existing[record.id].payload, record.payload);
    });
    var results = [];
    for (var index = 0; index < changed.length; index += 1) {
      var record = changed[index];
      var current = existing[record.id];
      results.push(await window.commitRecordMutation({
        recordType: recordType, id: record.id, payload: record.payload
      }, current ? current.revision : 0));
    }
    return results;
  };
  window.migrateLegacyEnvelopeOnce = async function (legacyEnvelope, recordType) {
    var collectionName = collectionFor(recordType);
    var existing = await window.loadV2Records(collectionName);
    var report = safety.migrateLegacyEnvelopeOnce(legacyEnvelope, recordType);
    var existingById = Object.create(null);
    existing.forEach(function (record) { existingById[record.id] = record; });
    var migrated = 0;
    for (var index = 0; index < report.records.length; index += 1) {
      var record = report.records[index];
      if (existingById[record.id]) {
        if (existingById[record.id].revision === 1 && !payloadEqual(existingById[record.id].payload, record.payload)) {
          window.enterReadOnlySafetyMode("Legacy migration conflict for " + record.id + ".");
          throw new Error("Legacy migration conflict for " + record.id + ".");
        }
        continue;
      }
      await window.commitRecordMutation({ recordType: recordType, id: record.id, payload: record.payload }, 0);
      migrated += 1;
    }
    var complete = await window.loadV2Records(collectionName);
    var missing = report.records.filter(function (record) {
      return !complete.some(function (current) { return current.id === record.id; });
    });
    if (missing.length) throw new Error("Legacy migration parity check failed.");
    return { records: complete, migrated: migrated, alreadyComplete: migrated === 0 };
  };
  window.moveRecordToTrash = async function (recordType, recordId, expectedRevision) {
    var active = requireConfig();
    var result = await active.port.trash(collectionFor(recordType), recordType, recordId, expectedRevision, active.deviceId);
    if (cache[collectionFor(recordType)]) delete cache[collectionFor(recordType)][recordId];
    return result;
  };
  window.restoreTrashRecord = async function (trashId, expectedRevision) {
    var active = requireConfig();
    var restored = await active.port.restore(trashId, expectedRevision, active.deviceId);
    var collectionName = collectionFor(restored.recordType);
    if (!cache[collectionName]) cache[collectionName] = Object.create(null);
    cache[collectionName][restored.id] = restored;
    return restored;
  };
  window.loadV2Trash = function () { return requireConfig().port.list("trash"); };
  window.getV2RecordRevision = function (collectionName, id) {
    return cache[collectionName] && cache[collectionName][id] ? cache[collectionName][id].revision : 0;
  };
  window.isV2RecordPending = function (collectionName, id) {
    return Boolean(pending[collectionName + "/" + id]);
  };
  window.v2RecordIdFor = function (rawRecord, recordType) {
    return safety.migrateLegacyEnvelopeOnce([rawRecord], recordType).records[0].id;
  };
  window.exportRecoveryBundle = async function () {
    var active = requireConfig();
    var results = await Promise.all([active.port.list("goals"), active.port.list("hubApps"), active.port.list("trash"), active.port.list("changeLog")]);
    return safety.exportRecoveryBundle({ records: results[0].concat(results[1]), trash: results[2], changeLog: results[3] });
  };
  window.showV2Recovery = async function () {
    var trash = await window.loadV2Trash();
    if (!trash.length) { window.alert("Trash is empty."); return; }
    var lines = trash.map(function (entry, index) { return (index + 1) + ". " + entry.recordType + ": " + (entry.payload.title || entry.payload.name || entry.recordId); });
    var choice = window.prompt("Trash (30-day recovery)\\n\\n" + lines.join("\\n") + "\\n\\nEnter a number to restore, or Cancel.");
    var selected = trash[Number(choice) - 1];
    if (selected) {
      await window.restoreTrashRecord(selected.id, selected.revision);
      window.alert("Restored. Reload to display the recovered record.");
    }
  };
  function addRecoveryButton() {
    if (document.getElementById("v2-recovery-button")) return;
    var button = document.createElement("button");
    button.id = "v2-recovery-button";
    button.type = "button";
    button.textContent = "Recovery";
    button.title = "Open cloud Trash and restore deleted records";
    button.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:9999;padding:9px 12px;border:1px solid #777;border-radius:8px;background:#fff;color:#222";
    button.addEventListener("click", function () { window.showV2Recovery().catch(function (error) { window.alert(error.message); }); });
    document.body.appendChild(button);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addRecoveryButton);
  else addRecoveryButton();
})();
