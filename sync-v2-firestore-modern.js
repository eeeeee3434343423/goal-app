(function () {
  "use strict";
  window.createModernV2Port = function (db, fire, uid) {
    function base(name) { return fire.collection(db, "users", uid, name); }
    function ref(name, id) { return fire.doc(db, "users", uid, name, id); }
    function focusRef() { return ref("focus", "active-goal"); }
    function conflict() { var error = new Error("Cloud record changed on another device."); error.code = "REVISION_CONFLICT"; return error; }
    function focusLocked(activeGoalId) {
      var error = new Error("Complete the current active goal before activating another.");
      error.code = "FOCUS_LOCKED";
      error.activeGoalId = activeGoalId;
      return error;
    }
    function focusMismatch(activeGoalId) {
      var error = new Error("Only the current active goal can be completed.");
      error.code = "FOCUS_MISMATCH";
      error.activeGoalId = activeGoalId;
      return error;
    }
    function hasCompletionOutcome(payload) {
      return Boolean(payload) && (payload.achievedAt != null || payload.outcome != null);
    }
    function eventRef() { return fire.doc(base("changeLog")); }
    return {
      list: async function (name) {
        var snap = await fire.getDocs(base(name));
        return snap.docs.map(function (entry) { return Object.assign({ id: entry.id }, entry.data()); });
      },
      readFocus: async function () {
        var snap = await fire.getDoc(focusRef());
        if (!snap.exists()) return { activeGoalId: null, revision: 0 };
        return snap.data();
      },
      commit: function (name, mutation, expectedRevision, deviceId) {
        var liveRef = ref(name, mutation.id);
        var result;
        return fire.runTransaction(db, async function (tx) {
          var snap = await tx.get(liveRef);
          var current = snap.exists() ? snap.data() : null;
          var revision = current && Number.isSafeInteger(current.revision) ? current.revision : 0;
          if (revision !== expectedRevision) throw conflict();
          result = {
            id: mutation.id, payload: mutation.payload, schemaVersion: 2, revision: revision + 1,
            createdAt: current ? current.createdAt : fire.serverTimestamp(),
            updatedAt: fire.serverTimestamp(), updatedBy: deviceId
          };
          tx.set(liveRef, result);
          tx.set(eventRef(), {
            operation: current ? "update" : "create", recordType: mutation.recordType,
            recordId: mutation.id, beforeRevision: revision, afterRevision: revision + 1,
            timestamp: fire.serverTimestamp(), actorUid: uid
          });
        }).then(function () { return result; });
      },
      commitGoalActivation: function (mutation, expectedGoalRevision, expectedFocusRevision, deviceId) {
        if (!mutation || mutation.recordType !== "goal") throw new TypeError("Goal activation requires a goal mutation.");
        var liveRef = ref("goals", mutation.id);
        var activeFocusRef = focusRef();
        var result;
        return fire.runTransaction(db, async function (tx) {
          var snapshots = await Promise.all([tx.get(liveRef), tx.get(activeFocusRef)]);
          var goalSnap = snapshots[0];
          var focusSnap = snapshots[1];
          var currentGoal = goalSnap.exists() ? goalSnap.data() : null;
          var currentFocus = focusSnap.exists() ? focusSnap.data() : null;
          var goalRevision = currentGoal && Number.isSafeInteger(currentGoal.revision) ? currentGoal.revision : 0;
          var focusRevision = currentFocus && Number.isSafeInteger(currentFocus.revision) ? currentFocus.revision : 0;
          if (currentFocus && currentFocus.activeGoalId !== null && currentFocus.activeGoalId !== mutation.id) {
            throw focusLocked(currentFocus.activeGoalId);
          }
          if (goalRevision !== expectedGoalRevision || focusRevision !== expectedFocusRevision) throw conflict();
          var goal = {
            id: mutation.id, payload: mutation.payload, schemaVersion: 2, revision: goalRevision + 1,
            createdAt: currentGoal ? currentGoal.createdAt : fire.serverTimestamp(),
            updatedAt: fire.serverTimestamp(), updatedBy: deviceId
          };
          var focus = {
            activeGoalId: mutation.id, revision: focusRevision + 1,
            createdAt: currentFocus ? currentFocus.createdAt : fire.serverTimestamp(),
            updatedAt: fire.serverTimestamp(), updatedBy: deviceId
          };
          tx.set(liveRef, goal);
          tx.set(activeFocusRef, focus);
          tx.set(eventRef(), {
            operation: currentGoal ? "update" : "create", recordType: "goal", recordId: mutation.id,
            beforeRevision: goalRevision, afterRevision: goalRevision + 1,
            timestamp: fire.serverTimestamp(), actorUid: uid
          });
          result = { goal: goal, focus: focus };
        }).then(function () { return result; });
      },
      commitGoalCompletion: function (mutation, expectedGoalRevision, expectedFocusRevision, deviceId) {
        if (!mutation || mutation.recordType !== "goal" || !hasCompletionOutcome(mutation.payload)) {
          throw new TypeError("Goal completion requires achievedAt or outcome.");
        }
        var liveRef = ref("goals", mutation.id);
        var activeFocusRef = focusRef();
        var result;
        return fire.runTransaction(db, async function (tx) {
          var snapshots = await Promise.all([tx.get(liveRef), tx.get(activeFocusRef)]);
          var goalSnap = snapshots[0];
          var focusSnap = snapshots[1];
          var currentGoal = goalSnap.exists() ? goalSnap.data() : null;
          var currentFocus = focusSnap.exists() ? focusSnap.data() : null;
          var goalRevision = currentGoal && Number.isSafeInteger(currentGoal.revision) ? currentGoal.revision : 0;
          var focusRevision = currentFocus && Number.isSafeInteger(currentFocus.revision) ? currentFocus.revision : 0;
          if (!currentFocus || currentFocus.activeGoalId !== mutation.id) {
            throw focusMismatch(currentFocus ? currentFocus.activeGoalId : null);
          }
          if (goalRevision !== expectedGoalRevision || focusRevision !== expectedFocusRevision) throw conflict();
          var goal = {
            id: mutation.id, payload: mutation.payload, schemaVersion: 2, revision: goalRevision + 1,
            createdAt: currentGoal ? currentGoal.createdAt : fire.serverTimestamp(),
            updatedAt: fire.serverTimestamp(), updatedBy: deviceId
          };
          var focus = {
            activeGoalId: null, revision: focusRevision + 1,
            createdAt: currentFocus.createdAt, updatedAt: fire.serverTimestamp(), updatedBy: deviceId
          };
          tx.set(liveRef, goal);
          tx.set(activeFocusRef, focus);
          tx.set(eventRef(), {
            operation: "update", recordType: "goal", recordId: mutation.id,
            beforeRevision: goalRevision, afterRevision: goalRevision + 1,
            timestamp: fire.serverTimestamp(), actorUid: uid
          });
          result = { goal: goal, focus: focus };
        }).then(function () { return result; });
      },
      trash: function (name, recordType, recordId, expectedRevision, deviceId) {
        var liveRef = ref(name, recordId);
        var trashRef = ref("trash", recordType + "__" + recordId);
        var legacyRef = recordType === "goal" ? ref("appdata", "achieve.goals.v1") : null;
        var result;
        return fire.runTransaction(db, async function (tx) {
          var snap = await tx.get(liveRef);
          var legacySnap = legacyRef ? await tx.get(legacyRef) : null;
          if (!snap.exists()) throw new Error("Record not found.");
          var current = snap.data();
          if (current.revision !== expectedRevision) throw conflict();
          result = {
            id: recordType + "__" + recordId, recordType: recordType, recordId: recordId,
            payload: current.payload, revision: current.revision,
            deletedAt: fire.serverTimestamp(),
            purgeAfter: new Date(Date.now() + 30 * 86400000)
          };
          if (legacySnap && legacySnap.exists()) {
            var legacyData = legacySnap.data() || {};
            var durableTombstones = Object.assign({}, legacyData.tombstones || {});
            durableTombstones[recordId] = Date.now();
            tx.set(legacyRef, { tombstones: durableTombstones, updatedAt: Date.now() }, { merge: true });
          }
          tx.set(trashRef, result);
          tx.delete(liveRef);
          tx.set(eventRef(), {
            operation: "delete", recordType: recordType, recordId: recordId,
            beforeRevision: current.revision, afterRevision: current.revision,
            timestamp: fire.serverTimestamp(), actorUid: uid
          });
        }).then(function () { return result; });
      },
      restore: function (trashId, expectedRevision, deviceId) {
        var trashRef = ref("trash", trashId);
        var result;
        return fire.runTransaction(db, async function (tx) {
          var trashSnap = await tx.get(trashRef);
          if (!trashSnap.exists()) throw new Error("Trash record not found.");
          var entry = trashSnap.data();
          if (entry.revision !== expectedRevision) throw conflict();
          var name = entry.recordType === "goal" ? "goals" : "hubApps";
          var liveRef = ref(name, entry.recordId);
          var liveSnap = await tx.get(liveRef);
          if (liveSnap.exists()) throw conflict();
          result = {
            id: entry.recordId, recordType: entry.recordType, payload: entry.payload,
            schemaVersion: 2, revision: entry.revision + 1,
            createdAt: fire.serverTimestamp(), updatedAt: fire.serverTimestamp(), updatedBy: deviceId
          };
          var stored = Object.assign({}, result); delete stored.recordType;
          tx.set(liveRef, stored);
          tx.delete(trashRef);
          tx.set(eventRef(), {
            operation: "restore", recordType: entry.recordType, recordId: entry.recordId,
            beforeRevision: entry.revision, afterRevision: entry.revision + 1,
            timestamp: fire.serverTimestamp(), actorUid: uid
          });
        }).then(function () { return result; });
      }
    };
  };
})();
