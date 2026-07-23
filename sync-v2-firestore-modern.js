(function () {
  "use strict";
  window.createModernV2Port = function (db, fire, uid) {
    function base(name) { return fire.collection(db, "users", uid, name); }
    function ref(name, id) { return fire.doc(db, "users", uid, name, id); }
    function conflict() { var error = new Error("Cloud record changed on another device."); error.code = "REVISION_CONFLICT"; return error; }
    function eventRef() { return fire.doc(base("changeLog")); }
    return {
      list: async function (name) {
        var snap = await fire.getDocs(base(name));
        return snap.docs.map(function (entry) { return Object.assign({ id: entry.id }, entry.data()); });
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
      trash: function (name, recordType, recordId, expectedRevision, deviceId) {
        var liveRef = ref(name, recordId);
        var trashRef = ref("trash", recordType + "__" + recordId);
        var result;
        return fire.runTransaction(db, async function (tx) {
          var snap = await tx.get(liveRef);
          if (!snap.exists()) throw new Error("Record not found.");
          var current = snap.data();
          if (current.revision !== expectedRevision) throw conflict();
          result = {
            id: recordType + "__" + recordId, recordType: recordType, recordId: recordId,
            payload: current.payload, revision: current.revision,
            deletedAt: fire.serverTimestamp(),
            purgeAfter: new Date(Date.now() + 30 * 86400000)
          };
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
