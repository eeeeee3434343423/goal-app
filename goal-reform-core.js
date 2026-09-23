(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GoalReformCore = Object.freeze(api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /*
   * Goal App Reform core: pure, deterministic, no DOM, no network, no clock.
   * The user supplies every answer, estimate and date; this module only
   * normalizes, checks and does arithmetic. It never fills in a user field.
   *
   * Plan format mirrors the reference tracker:
   *   Objective (the goal) -> Campaigns (3-7 outcome milestones, estimated)
   *   -> Operations -> Missions (checkboxes). Progress rolls up from missions.
   */

  var CAMPAIGNS_MIN = 3;
  var CAMPAIGNS_MAX = 7;
  var RESEARCH_MIN = 3;
  var NEXT_ACTION_MAX_MINUTES = 30;
  var MAX_HOURS_PER_WEEK = 112;
  var BAND_LOW = 0.4;
  var BAND_HIGH = 0.6;
  var Z10 = -1.2815515655446004;
  var Z40 = -0.2533471031357997;
  var DAY_MS = 86400000;
  var GROWTH_KEYS = ["income", "skill", "health", "relationships", "freedom"];

  // Always vague: no number rescues them.
  var VAGUE_ALWAYS = [
    "as much as possible", "work on", "working on", "get into", "learn about", "look into",
    "figure out", "a lot", "lots of", "kind of", "sort of", "try", "trying", "tries",
    "stuff", "things", "somehow", "some", "maybe", "eventually", "soon", "someday",
    "asap", "hopefully", "explore", "various", "etc"
  ];
  // Vague unless the text contains a number that makes the comparison checkable.
  var VAGUE_COMPARATIVE = [
    "better", "more", "less", "improve", "improved", "improving", "faster", "bigger",
    "stronger", "healthier", "good", "great"
  ];

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function str(v) { return typeof v === "string" ? v : ""; }
  function has(v) { return typeof v === "string" && v.trim().length > 0; }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function idOr(v, fallback) { return typeof v === "string" && v ? v : fallback; }
  function num(v) {
    var n = typeof v === "number" ? v : (typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
    return isFinite(n) ? n : null;
  }
  function positive(v) { var n = num(v); return n !== null && n > 0 ? n : null; }

  // ------------------------------------------------------------ dates (UTC, YYYY-MM-DD)

  function isDateStr(v) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(toMs(v)); }
  function toMs(d) { var p = d.split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function fromMs(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function addDays(d, n) { return fromMs(toMs(d) + n * DAY_MS); }
  function daysBetween(a, b) { return Math.round((toMs(b) - toMs(a)) / DAY_MS); }

  // ------------------------------------------------------------ normalize

  function normEstimate(e) {
    e = isObj(e) ? e : {};
    return Object.assign({}, e, { best: positive(e.best), likely: positive(e.likely), worst: positive(e.worst) });
  }

  function normCampaign(c, i) {
    var cid = idOr(c.id, "c" + (i + 1));
    return Object.assign({}, c, {
      id: cid,
      title: str(c.title),
      result: str(c.result),
      estimate: normEstimate(c.estimate),
      operations: arr(c.operations).filter(isObj).map(function (o, j) {
        var oid = idOr(o.id, cid + "-o" + (j + 1));
        return Object.assign({}, o, {
          id: oid,
          title: str(o.title),
          missions: arr(o.missions).filter(isObj).map(function (m, k) {
            return Object.assign({}, m, { id: idOr(m.id, oid + "-m" + (k + 1)), text: str(m.text), done: m.done === true });
          })
        });
      })
    });
  }

  function normDecision(d) {
    var days = num(d.requestedDurationDays);
    return Object.assign({}, d, {
      inputMode: d.inputMode === "duration" ? "duration" : "date",
      date: isDateStr(d.date) ? d.date : "",
      requestedDurationDays: days !== null && days >= 1 ? Math.round(days) : null,
      rationale: str(d.rationale),
      assumptions: str(d.assumptions)
    });
  }

  function normalizeGoalPlan(value) {
    if (!isObj(value)) return null;
    var why = Array.isArray(value.whyLayers) ? value.whyLayers : [];
    var growth = isObj(value.growth) ? value.growth : {};
    var growthOut = Object.assign({}, growth);
    GROWTH_KEYS.forEach(function (k) {
      var n = num(growth[k]);
      growthOut[k] = n !== null && n >= 1 && n <= 5 && Math.round(n) === n ? n : null;
    });
    var cap = isObj(value.capacity) ? value.capacity : {};
    var next = isObj(value.nextAction) ? value.nextAction : {};
    return Object.assign({}, value, {
      version: 1,
      whyLayers: [0, 1, 2].map(function (i) { return str(why[i]); }),
      costOfInaction: str(value.costOfInaction),
      definition: str(value.definition),
      successEvidence: str(value.successEvidence),
      exclusions: str(value.exclusions),
      currentReality: str(value.currentReality),
      research: arr(value.research).filter(isObj).map(function (r, i) {
        return Object.assign({}, r, { id: idOr(r.id, "r" + (i + 1)), question: str(r.question), source: str(r.source), insight: str(r.insight) });
      }),
      unknowns: arr(value.unknowns).filter(function (u) { return typeof u === "string"; }),
      campaigns: arr(value.campaigns).filter(isObj).map(normCampaign),
      capacity: Object.assign({}, cap, { hoursPerWeek: positive(cap.hoursPerWeek), constraints: str(cap.constraints) }),
      nextAction: Object.assign({}, next, { text: str(next.text), minutes: positive(next.minutes) }),
      obstacles: arr(value.obstacles).filter(isObj).map(function (o) {
        return Object.assign({}, o, { if: str(o.if), then: str(o.then) });
      }),
      growth: growthOut,
      growthNote: str(value.growthNote),
      deadlineDecision: isObj(value.deadlineDecision) ? normDecision(value.deadlineDecision) : null
    });
  }

  // ------------------------------------------------------------ vague language

  function phraseRegex(phrase) {
    return new RegExp("\\b" + phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+") + "\\b", "gi");
  }

  function findVagueLanguage(text) {
    text = str(text);
    if (!text) return [];
    var lists = /\d/.test(text) ? [VAGUE_ALWAYS] : [VAGUE_ALWAYS, VAGUE_COMPARATIVE];
    var hits = [];
    lists.forEach(function (list) {
      list.forEach(function (phrase) {
        var re = phraseRegex(phrase), m;
        while ((m = re.exec(text)) !== null) hits.push({ phrase: phrase, index: m.index });
      });
    });
    hits.sort(function (a, b) { return a.index - b.index || b.phrase.length - a.phrase.length; });
    // Keep the longest phrase when two overlap ("lots of" wins over a shorter match inside it).
    var out = [], end = -1;
    hits.forEach(function (h) {
      if (h.index >= end) { out.push(h); end = h.index + h.phrase.length; }
    });
    return out;
  }

  function quoteList(hits) {
    var seen = {};
    return hits.filter(function (h) { var k = h.phrase.toLowerCase(); if (seen[k]) return false; seen[k] = true; return true; })
      .map(function (h) { return "\"" + h.phrase + "\""; }).join(", ");
  }

  // ------------------------------------------------------------ forecast

  function erf(x) {
    var sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return sign * y;
  }
  function normalCdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }

  function estimateError(c) {
    var e = c.estimate;
    if (e.best === null || e.likely === null || e.worst === null || !(e.best <= e.likely && e.likely <= e.worst)) {
      return "Campaign \"" + (c.title || c.id) + "\" needs focused-hour estimates where best \u2264 likely \u2264 worst.";
    }
    return "";
  }

  function calculateDeadlineForecast(planInput, today, opts) {
    var plan = normalizeGoalPlan(planInput) || normalizeGoalPlan({});
    opts = opts || {};
    if (!isDateStr(today)) return { ok: false, error: "Today's date is missing, so the deadline can't be calculated." };
    var hpw = plan.capacity.hoursPerWeek;
    if (hpw === null || hpw > MAX_HOURS_PER_WEEK) return { ok: false, error: "Enter how many focused hours per week you will commit (1 to 112)." };
    if (!plan.campaigns.length) return { ok: false, error: "Add campaigns with focused-hour estimates before setting a deadline." };
    for (var i = 0; i < plan.campaigns.length; i++) {
      var err = estimateError(plan.campaigns[i]);
      if (err) return { ok: false, error: err };
    }
    var cal = positive(opts.calibration) || 1;
    var rate = hpw / 7;
    var mean = 0, variance = 0, cumulative = [];
    plan.campaigns.forEach(function (c) {
      var e = c.estimate;
      mean += (e.best + 4 * e.likely + e.worst) / 6 * cal;
      var sd = (e.worst - e.best) / 6 * cal;
      variance += sd * sd;
      cumulative.push({ id: c.id, title: c.title, p50Hours: mean });
    });
    var sd = Math.sqrt(variance);
    function daysFor(h) { return Math.max(1, Math.ceil(h / rate - 1e-9)); }
    var p50Days = daysFor(mean);
    var earliestDays = Math.min(daysFor(mean + Z40 * sd), p50Days);
    var latestDays = Math.max(Math.floor((mean - Z40 * sd) / rate + 1e-9), p50Days);
    return {
      ok: true,
      today: today,
      hoursPerWeek: hpw,
      calibration: cal,
      hours: { mean: mean, sd: sd, p10: mean + Z10 * sd, p50: mean, p90: mean - Z10 * sd },
      dates: {
        p10: addDays(today, daysFor(mean + Z10 * sd)),
        p50: addDays(today, p50Days),
        p90: addDays(today, daysFor(mean - Z10 * sd))
      },
      band: { earliest: addDays(today, earliestDays), latest: addDays(today, latestDays), earliestDays: earliestDays, latestDays: latestDays },
      campaigns: cumulative.map(function (c) {
        return { id: c.id, title: c.title, p50Hours: c.p50Hours, p50Date: addDays(today, daysFor(c.p50Hours)) };
      })
    };
  }

  function probabilityForDate(forecast, date) {
    if (!forecast || !forecast.ok || !isDateStr(date)) return 0;
    var days = daysBetween(forecast.today, date);
    if (days <= 0) return 0;
    var available = days * forecast.hoursPerWeek / 7;
    if (forecast.hours.sd === 0) return available >= forecast.hours.mean - 1e-9 ? 1 : 0;
    return normalCdf((available - forecast.hours.mean) / forecast.hours.sd);
  }

  function requiredHoursPerWeek(forecast, fromDate, date) {
    var days = daysBetween(fromDate, date);
    if (days <= 0) return Infinity;
    return forecast.hours.mean / (days / 7);
  }

  function resolveDeadlineDate(decision, today) {
    var d = isObj(decision) ? normDecision(decision) : null;
    if (!d) return "";
    if (d.inputMode === "duration") return d.requestedDurationDays && isDateStr(today) ? addDays(today, d.requestedDurationDays) : "";
    return d.date;
  }

  function pct(p) { return Math.round(p * 100); }
  function round1(n) { return Math.round(n * 10) / 10; }

  function validateDeadlineDecision(decision, forecast, today) {
    if (!isObj(decision)) return ["Choose a deadline: enter a target date or how many days you want this goal to take."];
    var d = normDecision(decision);
    var errors = [];
    var date = resolveDeadlineDate(d, today);
    if (!date) {
      errors.push(d.inputMode === "duration" ? "Enter a duration of at least 1 day." : "Enter a target date.");
    } else if (isDateStr(today) && daysBetween(today, date) <= 0) {
      errors.push("The deadline must be in the future.");
    } else if (!forecast || !forecast.ok) {
      errors.push(forecast && forecast.error ? forecast.error : "The deadline can't be checked until estimates and weekly hours are filled in.");
    } else {
      var days = daysBetween(forecast.today, date);
      var p = probabilityForDate(forecast, date);
      var range = forecast.band.earliest === forecast.band.latest
        ? forecast.band.earliest
        : "a date from " + forecast.band.earliest + " to " + forecast.band.latest;
      if (days < forecast.band.earliestDays) {
        errors.push("This date is too aggressive: you'd hit it only about " + pct(p) + "% of the time. For a coin-flip, choose " +
          range + ", commit about " + round1(requiredHoursPerWeek(forecast, forecast.today, date)) + " focused hours per week (you committed " +
          forecast.hoursPerWeek + "), or cut scope.");
      } else if (days > forecast.band.latestDays) {
        errors.push("This date is too comfortable: you'd hit it about " + pct(p) + "% of the time, and the slack will get used up (Parkinson's law). Choose " +
          range + ".");
      }
    }
    if (!has(d.rationale)) errors.push("Write why this date: one sentence on why this deadline is right.");
    if (!has(d.assumptions)) errors.push("Write the assumptions this deadline depends on (hours, availability, resources).");
    return errors;
  }

  // ------------------------------------------------------------ clarity gate

  function campaignProblems(plan) {
    var cs = plan.campaigns, problems = [];
    if (cs.length < CAMPAIGNS_MIN || cs.length > CAMPAIGNS_MAX) {
      problems.push("Plan " + CAMPAIGNS_MIN + " to " + CAMPAIGNS_MAX + " campaigns (outcome milestones). You have " + cs.length + ".");
    }
    cs.forEach(function (c, i) {
      var name = "Campaign " + (i + 1);
      if (!has(c.title)) problems.push(name + " needs a title.");
      if (!has(c.result)) problems.push(name + " needs a WIN RESULT: the outcome that proves it's done.");
      else {
        var vague = findVagueLanguage(c.result);
        if (vague.length) problems.push(name + "'s WIN RESULT uses vague words: " + quoteList(vague) + ".");
      }
      var est = estimateError(c);
      if (est) problems.push(est);
      if (!c.operations.length) problems.push(name + " needs at least one operation.");
      c.operations.forEach(function (o, j) {
        var opName = name + ", operation " + (j + 1);
        if (!has(o.title)) problems.push(opName + " needs a title.");
        if (!o.missions.some(function (m) { return has(m.text); })) problems.push(opName + " needs at least one mission.");
      });
    });
    return problems;
  }

  function goalPlanReadiness(planInput, opts) {
    opts = opts || {};
    var plan = normalizeGoalPlan(planInput) || normalizeGoalPlan({});
    var missing = [];
    function need(key, ok, message) { if (!ok) missing.push({ key: key, message: message }); }
    function clearText(key, text, emptyMsg, label) {
      if (!has(text)) return need(key, false, emptyMsg);
      var vague = findVagueLanguage(text);
      need(key, !vague.length, label + " uses vague words: " + quoteList(vague) + ". Replace each one with something a stranger could check.");
    }

    need("purpose", plan.whyLayers.every(has),
      "Answer all three layers of why: why you want it, why that matters, and the deepest reason underneath.");
    need("costOfInaction", has(plan.costOfInaction), "Write what it costs you if this doesn't happen in the next year.");
    clearText("definition", plan.definition, "Write the finish line: \"I will know this is done when ...\"", "Your finish line");
    clearText("successEvidence", plan.successEvidence, "Name the number or artifact that proves the goal is done.", "Your proof");
    need("exclusions", has(plan.exclusions), "Write what this goal is NOT (out of scope), so it can't sprawl.");
    var sourced = plan.research.filter(function (r) { return has(r.source) && has(r.insight); }).length;
    need("research", sourced >= RESEARCH_MIN,
      "Collect at least " + RESEARCH_MIN + " research findings, each with a source (link, book, person) and what you learned. You have " + sourced + ".");
    var cp = campaignProblems(plan);
    need("campaigns", !cp.length, cp.join(" "));
    var hpw = plan.capacity.hoursPerWeek;
    need("capacity", hpw !== null && hpw <= MAX_HOURS_PER_WEEK, "Commit how many focused hours per week you will give this goal.");
    var mins = plan.nextAction.minutes;
    need("nextAction", has(plan.nextAction.text) && mins !== null && mins <= NEXT_ACTION_MAX_MINUTES,
      "Write one next action you can finish in " + NEXT_ACTION_MAX_MINUTES + " minutes or less, with its time.");
    need("obstacles", plan.obstacles.some(function (o) { return has(o.if) && has(o.then); }),
      "Write at least one \"If ___ happens, I will ___\" plan for what could stop you.");
    need("growth", GROWTH_KEYS.every(function (k) { return plan.growth[k] !== null; }),
      "Score how far this goal takes you (1-5) on income, skill, health, relationships and freedom.");
    var forecast = calculateDeadlineForecast(plan, opts.today, { calibration: opts.calibration });
    var deadlineErrors = validateDeadlineDecision(plan.deadlineDecision, forecast, opts.today);
    need("deadline", !deadlineErrors.length, deadlineErrors.join(" "));

    return { ready: missing.length === 0, missing: missing, forecast: forecast };
  }

  // ------------------------------------------------------------ progress + next action

  function planProgress(planInput) {
    var plan = normalizeGoalPlan(planInput) || normalizeGoalPlan({});
    var m = { done: 0, total: 0 }, o = { done: 0, total: 0 }, c = { done: 0, total: 0 };
    var byCampaign = plan.campaigns.map(function (camp) {
      var cm = { done: 0, total: 0 }, co = { done: 0, total: 0 };
      camp.operations.forEach(function (op) {
        var done = op.missions.filter(function (x) { return x.done; }).length;
        cm.done += done; cm.total += op.missions.length;
        co.total += 1;
        if (op.missions.length && done === op.missions.length) co.done += 1;
      });
      m.done += cm.done; m.total += cm.total;
      o.done += co.done; o.total += co.total;
      c.total += 1;
      var campDone = co.total > 0 && co.done === co.total;
      if (campDone) c.done += 1;
      return { id: camp.id, title: camp.title, done: campDone, missions: cm, operations: co, percent: cm.total ? Math.round(cm.done / cm.total * 100) : 0 };
    });
    return { missions: m, operations: o, campaigns: c, percent: m.total ? Math.round(m.done / m.total * 100) : 0, byCampaign: byCampaign };
  }

  function nextOpenMission(planInput) {
    var plan = normalizeGoalPlan(planInput) || normalizeGoalPlan({});
    for (var i = 0; i < plan.campaigns.length; i++) {
      var camp = plan.campaigns[i];
      for (var j = 0; j < camp.operations.length; j++) {
        var op = camp.operations[j];
        for (var k = 0; k < op.missions.length; k++) {
          if (!op.missions[k].done) {
            return { campaignId: camp.id, operationId: op.id, missionId: op.missions[k].id, text: op.missions[k].text };
          }
        }
      }
    }
    return null;
  }

  // ------------------------------------------------------------ pace + calibration

  function paceStatus(forecast, input) {
    var mean = forecast.hours.mean;
    var logged = Math.max(0, num(input.loggedHours) || 0);
    var total = daysBetween(input.startDate, input.deadline);
    var elapsed = Math.min(Math.max(daysBetween(input.startDate, input.today), 0), Math.max(total, 0));
    var daysLeft = daysBetween(input.today, input.deadline);
    var remaining = Math.max(0, mean - logged);
    var expected = total > 0 ? mean * elapsed / total : mean;
    var status;
    if (remaining > 0 && daysLeft < 0) status = "overdue";
    else if (logged < expected * 0.9) status = "behind";
    else if (expected > 0 && logged >= expected * 1.25) status = "ahead";
    else status = "on-pace";
    return {
      status: status,
      expectedHours: expected,
      loggedHours: logged,
      remainingHours: remaining,
      daysLeft: daysLeft,
      requiredHoursPerWeek: daysLeft > 0 ? remaining / (daysLeft / 7) : (remaining > 0 ? Infinity : 0),
      projectedFinish: logged > 0 && elapsed > 0 ? addDays(input.today, Math.ceil(remaining / (logged / elapsed))) : null
    };
  }

  function calibrationFactor(history) {
    var ratios = arr(history).filter(isObj).map(function (h) {
      var est = positive(h.estimatedHours), act = positive(h.actualHours);
      return est && act ? act / est : null;
    }).filter(function (r) { return r !== null; }).sort(function (a, b) { return a - b; });
    if (!ratios.length) return { factor: 1, samples: 0 };
    var mid = Math.floor(ratios.length / 2);
    var median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
    return { factor: Math.round(Math.min(3, Math.max(0.5, median)) * 1000) / 1000, samples: ratios.length };
  }

  return {
    CAMPAIGNS_MIN: CAMPAIGNS_MIN,
    CAMPAIGNS_MAX: CAMPAIGNS_MAX,
    RESEARCH_MIN: RESEARCH_MIN,
    NEXT_ACTION_MAX_MINUTES: NEXT_ACTION_MAX_MINUTES,
    BAND: { low: BAND_LOW, high: BAND_HIGH },
    GROWTH_KEYS: GROWTH_KEYS.slice(),
    addDays: addDays,
    daysBetween: daysBetween,
    normalizeGoalPlan: normalizeGoalPlan,
    findVagueLanguage: findVagueLanguage,
    calculateDeadlineForecast: calculateDeadlineForecast,
    probabilityForDate: probabilityForDate,
    requiredHoursPerWeek: requiredHoursPerWeek,
    resolveDeadlineDate: resolveDeadlineDate,
    validateDeadlineDecision: validateDeadlineDecision,
    goalPlanReadiness: goalPlanReadiness,
    planProgress: planProgress,
    nextOpenMission: nextOpenMission,
    paceStatus: paceStatus,
    calibrationFactor: calibrationFactor
  };
});
