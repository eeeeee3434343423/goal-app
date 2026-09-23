(function (root, factory) {
  "use strict";
  var core = root && root.GoalReformCore ? root.GoalReformCore
    : (typeof require === "function" ? require("./goal-reform-core.js") : null);
  var api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GoalReformUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (core) {
  "use strict";

  /*
   * Goal App Reform screens: Definition Workshop, deadline strip, Mission
   * Board, goal pipeline and the one-time switch-over. Spec: Obsidian
   * "Projects/Goal App Reform/Workshop Copy & Mission Board".
   *
   * The UI never writes an answer, estimate or date for the user. It talks to
   * the app only through the host adapter passed to mount():
   *   getGoals() -> goal[]            saveGoal(goal)
   *   createGoal(title) -> goal       activate(id, opts) -> bool|{ok,message}|Promise
   *   complete(id) -> bool|Promise    loggedHours(id) -> number
   *   today() -> "YYYY-MM-DD"         calibration() -> number (optional)
   *   copyText(text) (optional)       openDaily() (optional)
   *   mountEl: element the screens render into
   */

  var STAGES = [
    { name: "Purpose", title: "Why this goal?", keys: ["purpose", "costOfInaction"],
      intro: "If the why is weak, you'll quit on a bad week. Dig three layers down." },
    { name: "Definition", title: "What exactly counts as done?", keys: ["definition", "successEvidence", "exclusions"],
      intro: "A stranger should be able to check whether you did it. No \"better\", no \"more\", no \"work on\"." },
    { name: "Research", title: "What do people who've done this know?", keys: ["research"], skippable: true,
      intro: "Find at least 3 real data points before you plan. Research is capped so it can't become procrastination." },
    { name: "Plan", title: "Campaigns → Operations → Missions", keys: ["campaigns", "obstacles", "nextAction"],
      intro: "Break the goal into 3–7 campaigns. Each campaign ends in a result you can check. Under each: operations (workstreams) and missions (tickable tasks)." },
    { name: "Deadline", title: "Set a coin-flip deadline", keys: ["capacity", "deadline"],
      intro: "Work expands to fill the time you give it. A comfortable deadline gets eaten. Pick a date you'd hit about half the time, working at full focus. That's where the pressure comes from." },
    { name: "Growth", title: "How far does this take you?", keys: ["growth"],
      intro: "Score honestly. This is how you'll compare which goal deserves to be next." },
    { name: "Review", title: "Review & activate", keys: [],
      intro: "This is exactly what you're committing to. Every check must pass before the goal can go live." }
  ];
  var GROWTH_LABELS = { income: "Income", skill: "Skill", health: "Health", relationships: "Relationships", freedom: "Freedom" };
  var RESEARCH_PROMPTS = [
    "How long did someone similar take?", "What did it cost them?",
    "What's the most common reason people fail at this?", "What's the first thing experts do?"
  ];
  var PACE_LABEL = { ahead: "AHEAD", "on-pace": "ON PACE", behind: "BEHIND", overdue: "OVERDUE" };
  var GATE_LABELS = {
    purpose: "Three layers of why", costOfInaction: "Cost of not doing it", definition: "Finish line",
    successEvidence: "Proof", exclusions: "What this goal is not", research: "3 sourced findings",
    campaigns: "Campaigns, operations, missions", obstacles: "If / then plan", nextAction: "Next action ≤ 30 min",
    capacity: "Weekly focused hours", deadline: "Coin-flip deadline", growth: "Growth scores"
  };
  var GATE_TOTAL = 12;

  var host = null;
  var state = freshState();
  var saveTimers = {};
  var uidCounter = 0;

  function freshState() {
    return { view: "home", goalId: null, stage: 0, open: {}, confirm: null, flash: "", drafts: {} };
  }

  // ------------------------------------------------------------ helpers

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
    });
  }
  function a(v) { return esc(JSON.stringify(v)); }
  // Inline handler for GoalReformUI.fn(args...), with optional raw JS appended as the last arguments.
  function call(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    var raw = args.length && args[args.length - 1] && args[args.length - 1].raw ? args.pop().raw : null;
    var list = args.map(a);
    if (raw) list.push(raw);
    return "GoalReformUI." + fn + "(" + list.join(",") + ")";
  }
  function raw(js) { return { raw: js }; }
  function has(v) { return typeof v === "string" && v.trim().length > 0; }
  function uid(prefix) { uidCounter += 1; return prefix + "-" + Math.random().toString(36).slice(2, 8) + uidCounter; }
  function today() { return host && host.today ? host.today() : new Date().toISOString().slice(0, 10); }
  function calibration() { return host && host.calibration ? Number(host.calibration()) || 1 : 1; }
  function opts() { return { today: today(), calibration: calibration() }; }
  function goals() { return host ? host.getGoals() || [] : []; }
  function findGoal(id) { return goals().filter(function (g) { return g && g.id === id; })[0] || null; }
  function fmtHours(h) { return isFinite(h) ? (Math.round(h * 10) / 10) + " h" : "∞"; }
  function pctText(p) { return Math.round(p * 100) + "%"; }
  function fmtDate(d) {
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return d || "";
    var parts = d.split("-");
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return months[+parts[1] - 1] + " " + (+parts[2]) + ", " + parts[0];
  }
  // Inside a button the bar is decorative (the button's text carries the numbers).
  function bar(percent, cls, decorative) {
    var p = Math.max(0, Math.min(100, percent));
    var a11y = decorative ? " aria-hidden=\"true\"" : " role=\"progressbar\" aria-valuemin=\"0\" aria-valuemax=\"100\" aria-valuenow=\"" + p + "\"";
    return "<span class=\"grf-bar " + (cls || "") + "\"" + a11y + "><span style=\"width:" + p + "%\"></span></span>";
  }
  function pad2(n) { return n < 10 ? "0" + n : String(n); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function planOf(goal) {
    if (!goal) return core.normalizeGoalPlan({});
    if (state.drafts[goal.id]) return core.normalizeGoalPlan(state.drafts[goal.id]);
    return core.normalizeGoalPlan(goal.goalPlan) || core.normalizeGoalPlan({});
  }
  function draftFor(id) {
    if (!state.drafts[id]) state.drafts[id] = clone(planOf(findGoal(id)));
    return state.drafts[id];
  }
  function startOf(goal, plan) { return plan.activatedOn || (goal && goal.reformFocusSince) || ""; }
  // Freeze the forecast behind a deadline at the moment it's committed, so the
  // board's odds, pace and campaign dates don't drift as missions are ticked.
  function commitSnapshot(goalId, plan, remainingOnly) {
    var f = core.calculateDeadlineForecast(plan, today(), { calibration: calibration(), remainingOnly: remainingOnly });
    if (!f.ok || !plan.deadlineDecision) return plan;
    var date = core.resolveDeadlineDate(plan.deadlineDecision, today());
    plan.deadlineDecision = Object.assign({}, plan.deadlineDecision, { calculationSnapshot: {
      basedOn: today(), meanHours: f.hours.mean, sdHours: f.hours.sd, calibration: f.calibration,
      chance: date ? core.probabilityForDate(f, date) : null,
      loggedAtCommit: host && host.loggedHours ? Number(host.loggedHours(goalId)) || 0 : 0,
      campaigns: f.campaigns.map(function (c) { return { id: c.id, p50Date: c.p50Date }; })
    } });
    return plan;
  }
  function deadlineOf(goal, plan) {
    var d = plan.deadlineDecision ? core.resolveDeadlineDate(plan.deadlineDecision, startOf(goal, plan) || today()) : "";
    return d || (goal && goal.deadline) || "";
  }
  function stageDone(plan, i) {
    var r = core.goalPlanReadiness(plan, opts());
    if (i === STAGES.length - 1) return r.ready;
    var missing = r.missing.map(function (m) { return m.key; });
    return STAGES[i].keys.every(function (k) { return missing.indexOf(k) < 0; });
  }
  function canEnter(plan, i) {
    for (var j = 0; j < i; j++) if (!STAGES[j].skippable && !stageDone(plan, j)) return false;
    return true;
  }
  function firstOpenStage(plan) {
    for (var i = 0; i < STAGES.length - 1; i++) if (!stageDone(plan, i)) return i;
    return STAGES.length - 1;
  }
  function stageMissing(plan, i) {
    return core.goalPlanReadiness(plan, opts()).missing.filter(function (m) { return STAGES[i].keys.indexOf(m.key) >= 0; });
  }
  // The deadline stage already shows its gate message under the forecast strip.
  function stageCheckMissing(plan, i) {
    return stageMissing(plan, i).filter(function (m) { return !(STAGES[i].name === "Deadline" && m.key === "deadline"); });
  }

  // ------------------------------------------------------------ persistence

  function flush(id) {
    if (saveTimers[id]) { clearTimeout(saveTimers[id]); delete saveTimers[id]; }
    var plan = state.drafts[id];
    var goal = findGoal(id);
    if (!plan || !goal || !host) return;
    host.saveGoal(Object.assign({}, goal, { goalPlan: clone(plan) }));
  }
  function scheduleSave(id) {
    if (saveTimers[id]) clearTimeout(saveTimers[id]);
    saveTimers[id] = setTimeout(function () { flush(id); }, 400);
  }
  function key(k) { return /^\d+$/.test(k) ? +k : k; }
  function setPath(obj, path, value) {
    var parts = String(path).split(".");
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      var k = key(parts[i]);
      if (cur[k] == null || typeof cur[k] !== "object") cur[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      cur = cur[k];
    }
    cur[key(parts[parts.length - 1])] = value;
  }
  function getPath(obj, path) {
    return String(path).split(".").reduce(function (cur, k) { return cur == null ? undefined : cur[key(k)]; }, obj);
  }
  function coerce(value, kind) {
    if (kind === "num") return value === "" || value == null ? null : Number(value);
    if (kind === "lines") return String(value || "").split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    return value == null ? "" : String(value);
  }

  // ------------------------------------------------------------ fields

  function field(label, path, value, o) {
    o = o || {};
    var id = "grf-f-" + path.replace(/\./g, "-");
    var handler = o.kind ? call("set", path, raw("this.value," + a(o.kind))) : call("set", path, raw("this.value"));
    var input = o.textarea
      ? "<textarea id=\"" + id + "\" rows=\"" + (o.rows || 2) + "\" placeholder=\"" + esc(o.placeholder || "") + "\" oninput=\"" + handler + "\">" + esc(value) + "</textarea>"
      : "<input id=\"" + id + "\" type=\"" + (o.type || "text") + "\"" + (o.min != null ? " min=\"" + o.min + "\"" : "") +
        (o.step ? " step=\"" + o.step + "\"" : "") + " value=\"" + esc(value == null ? "" : value) + "\" placeholder=\"" +
        esc(o.placeholder || "") + "\" oninput=\"" + handler + "\"" + (o.type === "date" ? " onchange=\"" + handler + "\"" : "") + ">";
    return "<label class=\"grf-field\" for=\"" + id + "\"><span class=\"grf-label\">" + esc(label) + "</span>" +
      (o.help ? "<span class=\"grf-help\">" + esc(o.help) + "</span>" : "") + input +
      (o.vague ? "<span class=\"grf-live\" data-live=\"vague\" data-arg=\"" + esc(path) + "\">" + vagueChips(value) + "</span>" : "") +
      "</label>";
  }
  function vagueChips(text) {
    var seen = {};
    return core.findVagueLanguage(text || "")
      .filter(function (h) { if (seen[h.phrase]) return false; seen[h.phrase] = true; return true; })
      .map(function (h) { return "<span class=\"grf-chip\">\"" + esc(h.phrase) + "\" → make it measurable</span>"; }).join("");
  }

  // ------------------------------------------------------------ workshop stages

  function stagePurpose(plan) {
    return field("Why do you want this?", "whyLayers.0", plan.whyLayers[0], { textarea: true, help: "The first honest answer.", placeholder: "I want recurring income from my course" }) +
      field("Why does that matter?", "whyLayers.1", plan.whyLayers[1], { textarea: true, help: "Go one layer deeper.", placeholder: "It buys back hours I currently sell for wages" }) +
      field("And underneath that?", "whyLayers.2", plan.whyLayers[2], { textarea: true, help: "This is the real purpose. It's shown on your Mission Board every day.", placeholder: "Those hours are how I build the company full-time" }) +
      field("What does it cost you if this doesn't happen in the next 12 months?", "costOfInaction", plan.costOfInaction, { textarea: true, help: "Be concrete: money, time, health, a missed window." });
  }

  function stageDefinition(plan) {
    return field("Finish line", "definition", plan.definition, { textarea: true, vague: true, help: "Start with \"I will know this is done when…\"", placeholder: "…APEX earns $500 in Stripe payouts in one calendar month" }) +
      field("Proof", "successEvidence", plan.successEvidence, { textarea: true, vague: true, help: "The number, file, screenshot, or result that proves it.", placeholder: "Stripe monthly payout report ≥ $500" }) +
      field("This goal is NOT…", "exclusions", plan.exclusions, { textarea: true, help: "What you're deliberately not doing. Stops scope creep.", placeholder: "Not a mobile app. No paid ads." }) +
      field("Where am I today? (optional)", "currentReality", plan.currentReality, { textarea: true, help: "Honestly: what exists, what doesn't." });
  }

  function sourcedCount(plan) {
    return plan.research.filter(function (r) { return has(r.source) && has(r.insight); }).length;
  }
  function researchCapMinutes(plan) {
    var likely = plan.campaigns.reduce(function (s, c) { return s + (c.estimate.likely || 0); }, 0);
    return likely > 0 ? Math.max(15, Math.round(likely * 60 * 0.1)) : 60;
  }

  function stageResearch(plan) {
    var cards = plan.research.map(function (r, i) {
      return "<div class=\"grf-card grf-finding\"><div class=\"grf-row-head\"><b>Finding " + (i + 1) + "</b>" +
        "<button type=\"button\" class=\"grf-link\" onclick=\"" + call("removeItem", "research", i) + "\">Remove</button></div>" +
        field("What did I want to know?", "research." + i + ".question", r.question) +
        field("Source (link, book, or person)", "research." + i + ".source", r.source) +
        field("What I learned, in one sentence", "research." + i + ".insight", r.insight, { textarea: true }) + "</div>";
    }).join("");
    var prompts = RESEARCH_PROMPTS.map(function (q) {
      return "<button type=\"button\" class=\"grf-prompt\" onclick=\"" + call("addFinding", q) + "\">" + esc(q) + "</button>";
    }).join("");
    return "<p class=\"grf-counter\"><span class=\"grf-live\" data-live=\"sourced\">" + sourcedCount(plan) + "</span> / " + core.RESEARCH_MIN + " sourced findings</p>" +
      cards +
      "<div class=\"grf-prompts\"><span class=\"grf-help\">Start a finding from a question:</span>" + prompts +
      "<button type=\"button\" onclick=\"" + call("addFinding", "") + "\">+ Add finding</button></div>" +
      field("Things I still don't know (one per line)", "unknowns", plan.unknowns.join("\n"), { textarea: true, rows: 3, kind: "lines" }) +
      "<p class=\"grf-note\">Research cap: about " + researchCapMinutes(plan) + " minutes (10% of your likely effort, once estimated). When it's up, plan with what you know and list the rest as unknowns.</p>";
  }

  function estimateInputs(c, i) {
    return "<div class=\"grf-estimate\"><span class=\"grf-label\">Estimate in focused hours</span>" +
      "<span class=\"grf-help\">Focused hours = phone away, one task. Worst = if the usual problems happen.</span><div class=\"grf-est-row\">" +
      ["best", "likely", "worst"].map(function (k) {
        return field(k.charAt(0).toUpperCase() + k.slice(1), "campaigns." + i + ".estimate." + k, c.estimate[k], { type: "number", min: 0, step: "0.5", kind: "num" });
      }).join("") + "</div></div>";
  }

  function stagePlan(plan) {
    var campaigns = plan.campaigns.map(function (c, i) {
      var ops = c.operations.map(function (o, j) {
        var missions = o.missions.map(function (m, k) {
          var p = "campaigns." + i + ".operations." + j + ".missions." + k;
          return "<div class=\"grf-mission-edit\"><span class=\"grf-num\">M-" + (i + 1) + "." + (j + 1) + "." + (k + 1) + "</span>" +
            "<input aria-label=\"Mission " + (i + 1) + "." + (j + 1) + "." + (k + 1) + "\" value=\"" + esc(m.text) + "\" placeholder=\"A task you can tick off\" oninput=\"" +
            call("set", p + ".text", raw("this.value")) + "\" onkeydown=\"if(event.key==='Enter'){event.preventDefault();" + call("addMission", i, j) + "}\">" +
            "<button type=\"button\" class=\"grf-link\" aria-label=\"Remove mission\" onclick=\"" + call("removeItem", "campaigns." + i + ".operations." + j + ".missions", k) + "\">×</button></div>";
        }).join("");
        return "<div class=\"grf-op-edit\"><div class=\"grf-row-head\"><span class=\"grf-num\">OPERATION " + (i + 1) + "." + (j + 1) + "</span>" +
          "<button type=\"button\" class=\"grf-link\" onclick=\"" + call("removeItem", "campaigns." + i + ".operations", j) + "\">Remove operation</button></div>" +
          field("Operation (a workstream)", "campaigns." + i + ".operations." + j + ".title", o.title) + missions +
          "<button type=\"button\" class=\"grf-small\" onclick=\"" + call("addMission", i, j) + "\">+ Mission</button></div>";
      }).join("");
      return "<div class=\"grf-card grf-campaign-edit\"><div class=\"grf-row-head\"><span class=\"grf-kicker\">" + pad2(i + 1) + " CAMPAIGN</span><span>" +
        "<button type=\"button\" class=\"grf-link\" onclick=\"" + call("moveItem", "campaigns", i, -1) + "\"" + (i === 0 ? " disabled" : "") + ">Up</button>" +
        "<button type=\"button\" class=\"grf-link\" onclick=\"" + call("moveItem", "campaigns", i, 1) + "\"" + (i === plan.campaigns.length - 1 ? " disabled" : "") + ">Down</button>" +
        "<button type=\"button\" class=\"grf-link\" onclick=\"" + call("removeItem", "campaigns", i) + "\">Remove</button></span></div>" +
        field("Campaign", "campaigns." + i + ".title", c.title, { placeholder: "Checkout live" }) +
        field("WIN RESULT", "campaigns." + i + ".result", c.result, { vague: true, help: "The outcome that proves this campaign is done.", placeholder: "Checkout takes a real $1 test payment" }) +
        estimateInputs(c, i) + ops +
        "<button type=\"button\" class=\"grf-small\" onclick=\"" + call("addOperation", i) + "\">+ Operation</button></div>";
    }).join("");
    var obstacles = plan.obstacles.map(function (o, i) {
      return "<div class=\"grf-card grf-obstacle\">" + field("If this happens…", "obstacles." + i + ".if", o.if) +
        field("…I will", "obstacles." + i + ".then", o.then) +
        "<button type=\"button\" class=\"grf-link\" onclick=\"" + call("removeItem", "obstacles", i) + "\">Remove</button></div>";
    }).join("");
    return campaigns +
      (plan.campaigns.length < core.CAMPAIGNS_MAX
        ? "<button type=\"button\" onclick=\"" + call("addCampaign") + "\">+ Campaign (" + plan.campaigns.length + " of 3–7)</button>"
        : "<p class=\"grf-note\">7 campaigns is the maximum. Merge some if the plan needs more.</p>") +
      "<h4 class=\"grf-h\">Obstacles &amp; counter-moves</h4>" + obstacles +
      "<button type=\"button\" onclick=\"" + call("addObstacle") + "\">+ If / then plan</button>" +
      "<h4 class=\"grf-h\">Next action</h4>" +
      field("The very next physical step", "nextAction.text", plan.nextAction.text, { help: "If it takes more than 30 minutes, break it down." }) +
      field("Minutes (30 or less)", "nextAction.minutes", plan.nextAction.minutes, { type: "number", min: 1, kind: "num" });
  }

  function renderDeadlineStrip(forecast, chosenDate) {
    if (!forecast || !forecast.ok) {
      return "<div class=\"grf-strip-empty\">" + esc(forecast && forecast.error ? forecast.error : "Fill in estimates and weekly hours to see the forecast.") + "</div>";
    }
    // Scale the track to the forecast, not to the chosen date, so the three
    // markers stay readable; a far-off date is pinned at the edge with an arrow.
    var start = forecast.today;
    var end = core.addDays(forecast.dates.p90, Math.max(2, Math.round(core.daysBetween(start, forecast.dates.p90) * 0.15)));
    var span = Math.max(1, core.daysBetween(start, end));
    function pos(d) { return Math.max(0, Math.min(100, core.daysBetween(start, d) / span * 100)); }
    var bandL = pos(forecast.band.earliest), bandR = pos(forecast.band.latest);
    var marks = [["p10", "P10 · Extreme", "1 in 10"], ["p50", "P50 · Coin-flip", "about half"], ["p90", "P90 · Comfortable", "padding, gets eaten"]]
      .map(function (m) {
        return "<div class=\"grf-mark grf-mark-" + m[0] + "\" style=\"left:" + pos(forecast.dates[m[0]]) + "%\"><span>" + m[1] +
          "</span><b>" + fmtDate(forecast.dates[m[0]]) + "</b><i>" + m[2] + "</i></div>";
      }).join("");
    var beyond = chosenDate && chosenDate > end;
    var pin = chosenDate ? "<div class=\"grf-pin" + (beyond ? " grf-pin-beyond" : "") + "\" style=\"left:" + pos(chosenDate) + "%\" title=\"Your date\">" +
      (beyond ? "<span>→ " + fmtDate(chosenDate) + "</span>" : "") + "</div>" : "";
    var yours = chosenDate
      ? "<p class=\"grf-yourdate\">Your date: <b>" + fmtDate(chosenDate) + "</b>, " + pctText(core.probabilityForDate(forecast, chosenDate)) + " chance at full focus.</p>"
      : "";
    var campaigns = forecast.campaigns.map(function (c, i) {
      return "<li>" + pad2(i + 1) + " " + esc(c.title || "Campaign " + (i + 1)) + ": P50 " + fmtDate(c.p50Date) + "</li>";
    }).join("");
    return "<div class=\"grf-strip\" aria-label=\"Deadline forecast\"><div class=\"grf-track\"><div class=\"grf-band\" style=\"left:" + bandL +
      "%;width:" + Math.max(1.5, bandR - bandL) + "%\"></div>" + marks + pin + "</div></div>" + yours +
      "<p class=\"grf-help\">Coin-flip window: " + fmtDate(forecast.band.earliest) + (forecast.band.latest !== forecast.band.earliest ? " to " + fmtDate(forecast.band.latest) : "") +
      ". Likely effort: " + fmtHours(forecast.hours.mean) + " focused.</p>" +
      (campaigns ? "<ul class=\"grf-campaign-dates\">" + campaigns + "</ul>" : "");
  }

  function deadlineLive(plan) {
    var forecast = core.calculateDeadlineForecast(plan, today(), { calibration: calibration() });
    var chosen = plan.deadlineDecision ? core.resolveDeadlineDate(plan.deadlineDecision, today()) : "";
    var errors = plan.deadlineDecision ? core.validateDeadlineDecision(plan.deadlineDecision, forecast, today()) : [];
    var hpw = plan.capacity.hoursPerWeek;
    return (hpw ? "<p class=\"grf-note\">" + fmtHours(hpw) + "/week = " + fmtHours(hpw / 7) + " every day.</p>" : "") +
      renderDeadlineStrip(forecast, chosen) +
      (calibration() !== 1 ? "<p class=\"grf-note\">Your past goals took " + calibration() + "× your estimates. The forecast includes that.</p>" : "") +
      (errors.length ? "<div class=\"grf-gate-msg\">" + errors.map(esc).join("<br>") + "</div>"
        : (chosen ? "<div class=\"grf-ok\">✓ This deadline is in the coin-flip zone.</div>" : ""));
  }

  function stageDeadline(plan) {
    var d = plan.deadlineDecision || { inputMode: "date" };
    var mode = d.inputMode === "duration" ? "duration" : "date";
    return "<blockquote class=\"grf-quote\">Give yourself 30 days and it takes 30 days. Give yourself a coin-flip, and you move.</blockquote>" +
      field("Focused hours per week you will commit", "capacity.hoursPerWeek", plan.capacity.hoursPerWeek, { type: "number", min: 1, step: "0.5", kind: "num" }) +
      field("What limits your time? (job, school…)", "capacity.constraints", plan.capacity.constraints) +
      "<div class=\"grf-toggle\" role=\"group\" aria-label=\"How to set the deadline\">" +
      "<button type=\"button\" class=\"" + (mode === "date" ? "on" : "") + "\" aria-pressed=\"" + (mode === "date") + "\" onclick=\"" + call("pick", "deadlineDecision.inputMode", "date") + "\">I have a date</button>" +
      "<button type=\"button\" class=\"" + (mode === "duration" ? "on" : "") + "\" aria-pressed=\"" + (mode === "duration") + "\" onclick=\"" + call("pick", "deadlineDecision.inputMode", "duration") + "\">I have a duration</button></div>" +
      (mode === "date"
        ? field("Target date", "deadlineDecision.date", d.date, { type: "date" })
        : field("How many days?", "deadlineDecision.requestedDurationDays", d.requestedDurationDays, { type: "number", min: 1, kind: "num" })) +
      "<div class=\"grf-live\" data-live=\"deadline\">" + deadlineLive(plan) + "</div>" +
      field("Why this date?", "deadlineDecision.rationale", d.rationale, { help: "One sentence." }) +
      field("This only works if…", "deadlineDecision.assumptions", d.assumptions, { help: "Hours, availability, resources." });
  }

  function stageGrowth(plan) {
    return core.GROWTH_KEYS.map(function (k) {
      var v = plan.growth[k];
      var buttons = [1, 2, 3, 4, 5].map(function (n) {
        return "<button type=\"button\" class=\"" + (v === n ? "on" : "") + "\" aria-pressed=\"" + (v === n) + "\" aria-label=\"" + GROWTH_LABELS[k] + " " + n + "\" onclick=\"" +
          call("pick", "growth." + k, n) + "\">" + n + "</button>";
      }).join("");
      return "<div class=\"grf-growth-row\"><span class=\"grf-label\">" + GROWTH_LABELS[k] + "</span><div class=\"grf-seg\">" + buttons + "</div></div>";
    }).join("") + "<p class=\"grf-help\">1 = barely moves it · 3 = noticeable · 5 = life-changing</p>" +
      field("In one sentence, what does this unlock next? (optional)", "growthNote", plan.growthNote);
  }

  function growthBars(plan) {
    return "<div class=\"grf-growth-bars\">" + core.GROWTH_KEYS.map(function (k) {
      var v = plan.growth[k] || 0;
      return "<div><span>" + GROWTH_LABELS[k] + "</span>" + bar(v * 20, "grf-bar-gold") + "<b>" + (v || "–") + "</b></div>";
    }).join("") + "</div>";
  }

  function gateList(plan) {
    var byKey = {};
    core.goalPlanReadiness(plan, opts()).missing.forEach(function (m) { byKey[m.key] = m.message; });
    var rows = [];
    STAGES.forEach(function (s, i) {
      s.keys.forEach(function (k) {
        rows.push("<li class=\"" + (byKey[k] ? "bad" : "good") + "\"><button type=\"button\" class=\"grf-link\" onclick=\"" + call("stageTo", i) + "\">" +
          (byKey[k] ? "✗ " : "✓ ") + esc(GATE_LABELS[k] || k) + "</button>" + (byKey[k] ? "<span>" + esc(byKey[k]) + "</span>" : "") + "</li>");
      });
    });
    return "<ul class=\"grf-gate\">" + rows.join("") + "</ul>";
  }

  function withPlan(list, id, plan) {
    return list.map(function (g) { return g && g.id === id ? Object.assign({}, g, { goalPlan: plan }) : g; });
  }

  function stageReview(goal, plan) {
    var isActive = core.pipelineStage(goal, opts()) === "active";
    var blocker = isActive ? "" : core.activationBlocker(withPlan(goals(), goal.id, plan), goal.id, opts());
    var primary = isActive
      ? "<button type=\"button\" class=\"primary\" onclick=\"" + call("go", "board") + "\">Back to Mission Board</button>"
      : blocker ? "<span class=\"grf-blocked\">" + esc(blocker) + "</span>"
        : "<button type=\"button\" class=\"primary\" onclick=\"" + call("activate", goal.id) + "\">Activate now</button>";
    return "<h4 class=\"grf-h\">Clarity Gate</h4><div class=\"grf-live\" data-live=\"gate\">" + gateList(plan) + "</div>" +
      "<h4 class=\"grf-h\">What you're committing to</h4><div class=\"grf-preview\">" + objectiveCard(goal, plan, { preview: true }) + boardBody(goal, plan, { preview: true }) + "</div>" +
      "<div class=\"grf-actions\"><button type=\"button\" onclick=\"" + call("copyReview", goal.id) + "\">Ask an AI to question this plan (it must not rewrite it)</button></div>" +
      "<div class=\"grf-actions\">" +
      "<button type=\"button\" onclick=\"" + call("go", "pipeline") + "\">Save &amp; back to goals</button>" + primary + "</div>";
  }

  function stageCheck(missing, passes) {
    if (missing.length) return "<div class=\"grf-gate-msg\">" + missing.map(function (m) { return esc(m.message); }).join("<br>") + "</div>";
    return passes ? "<div class=\"grf-ok\">✓ This stage passes.</div>" : "";
  }

  function renderWorkshop(goal, stageIndex) {
    var plan = planOf(goal);
    var stage = STAGES[stageIndex] || STAGES[0];
    var rail = STAGES.map(function (s, i) {
      var done = stageDone(plan, i), enter = canEnter(plan, i);
      return "<button type=\"button\" class=\"grf-rail-step" + (i === stageIndex ? " current" : "") + (done ? " done" : "") + "\"" +
        (i === stageIndex ? " aria-current=\"step\"" : "") + (enter ? "" : " disabled title=\"Finish the earlier stages first\"") +
        " onclick=\"" + call("stageTo", i) + "\">" + (done ? "✓ " : "") + esc(s.name) + "</button>";
    }).join("");
    var bodies = [stagePurpose, stageDefinition, stageResearch, stagePlan, stageDeadline, stageGrowth];
    var last = stageIndex === STAGES.length - 1;
    var body = last ? stageReview(goal, plan) : bodies[stageIndex](plan);
    var canNext = !last && (stage.skippable || stageDone(plan, stageIndex));
    return "<section class=\"grf grf-workshop\" aria-label=\"Definition Workshop\">" +
      (state.flash ? "<div class=\"grf-flash\" role=\"status\">" + esc(state.flash) + "</div>" : "") +
      "<header class=\"grf-top\"><div><span class=\"grf-kicker\">DEFINING · STAGE " + (stageIndex + 1) + " OF " + STAGES.length + "</span>" +
      "<h2>" + esc(goal.title || "Untitled goal") + "</h2></div>" +
      "<button type=\"button\" onclick=\"" + call("go", "pipeline") + "\">Save &amp; exit</button></header>" +
      "<nav class=\"grf-rail\" aria-label=\"Workshop stages\">" + rail + "</nav>" +
      "<div class=\"grf-stage\"><h3>" + esc(stage.title) + "</h3><p class=\"grf-intro\">" + esc(stage.intro) + "</p>" + body + "</div>" +
      (!last ? "<div class=\"grf-live\" data-live=\"stagecheck\">" + stageCheck(stageCheckMissing(plan, stageIndex), stageDone(plan, stageIndex)) + "</div>" : "") +
      "<footer class=\"grf-nav\">" +
      (stageIndex > 0 ? "<button type=\"button\" onclick=\"" + call("stageTo", stageIndex - 1) + "\">← " + esc(STAGES[stageIndex - 1].name) + "</button>" : "<span></span>") +
      (!last
        ? "<button type=\"button\" class=\"primary grf-next-btn\"" + (canNext ? "" : " disabled") + " onclick=\"" + call("stageTo", stageIndex + 1) + "\">Next: " +
          esc(STAGES[stageIndex + 1].name) + " →</button>" : "") +
      "</footer></section>";
  }

  // ------------------------------------------------------------ mission board

  function objectiveCard(goal, plan, o) {
    o = o || {};
    var t = today();
    // Pace and odds are measured from the day the goal took the focus. Without
    // that date (an old goal not yet re-planned) they'd be fiction, so hide them.
    var known = startOf(goal, plan);
    var start = known || t;
    var deadline = deadlineOf(goal, plan);
    // Once committed, the board uses the numbers frozen at commit time (after a
    // re-plan they cover only the remaining work); before that, a live forecast.
    var snap = !o.preview && plan.deadlineDecision && plan.deadlineDecision.calculationSnapshot;
    var forecast = snap && snap.meanHours > 0
      ? { ok: true, hours: { mean: snap.meanHours } }
      : core.calculateDeadlineForecast(plan, start, { calibration: calibration() });
    var progress = core.planProgress(plan);
    var loggedTotal = !o.preview && host && host.loggedHours ? Number(host.loggedHours(goal.id)) || 0 : 0;
    var logged = Math.max(0, loggedTotal - (snap && snap.loggedAtCommit > 0 ? snap.loggedAtCommit : 0));
    var daysLeft = deadline ? core.daysBetween(t, deadline) : null;
    var pace = !o.preview && known && forecast.ok && deadline && daysLeft >= 0
      ? core.paceStatus(forecast, { startDate: start, deadline: deadline, loggedHours: logged, today: t }) : null;
    var status = !o.preview && deadline && daysLeft < 0 ? "overdue" : (pace ? pace.status : "");
    var chance = snap && typeof snap.chance === "number" ? snap.chance
      : (known || o.preview) && forecast.ok && forecast.band && deadline ? core.probabilityForDate(forecast, deadline) : null;
    var next = core.nextOpenMission(plan);
    var confirm = !o.preview && state.confirm && state.confirm.id === goal.id ? state.confirm : null;
    var purpose = plan.whyLayers[2] || goal.why || goal.description || "";

    var nextPanel;
    if (confirm && confirm.kind === "next") {
      nextPanel = "<div class=\"grf-panel\"><b>What's the next action?</b>" +
        (next ? "<p class=\"grf-help\">Next unfinished mission: " + esc(next.text) + "</p>" : "") +
        "<label class=\"grf-field\"><span class=\"grf-label\">Next action</span><input id=\"grf-next-text\" placeholder=\"The very next physical step\"></label>" +
        "<label class=\"grf-field\"><span class=\"grf-label\">Minutes (30 or less)</span><input id=\"grf-next-min\" type=\"number\" min=\"1\" max=\"30\"></label>" +
        (confirm.error ? "<div class=\"grf-gate-msg\">" + esc(confirm.error) + "</div>" : "") +
        "<div class=\"grf-actions\"><button type=\"button\" class=\"primary\" onclick=\"" + call("saveNextAction", goal.id) + "\">Set next action</button>" +
        "<button type=\"button\" onclick=\"" + call("cancelConfirm") + "\">Cancel</button></div></div>";
    } else {
      nextPanel = "<div class=\"grf-next\"><span class=\"grf-kicker\">▶ NEXT ACTION" + (plan.nextAction.minutes ? " (" + plan.nextAction.minutes + " min)" : "") +
        "</span><p>" + esc(plan.nextAction.text || "No next action set yet.") + "</p>" +
        (o.preview ? "" : "<div class=\"grf-actions\"><button type=\"button\" class=\"primary\" onclick=\"" + call("nextActionDone", goal.id) + "\">" +
          (has(plan.nextAction.text) ? "Done → pick next" : "Set next action") + "</button></div>") + "</div>";
    }

    return "<div class=\"grf-objective\"><div class=\"grf-row-head\"><span class=\"grf-kicker\">STRATEGIC OBJECTIVE</span>" +
      (status ? "<span class=\"grf-pace grf-pace-" + status + "\">● " + PACE_LABEL[status] + "</span>" : "") + "</div>" +
      "<h2>" + esc(plan.definition || goal.title) + "</h2>" +
      (purpose ? "<p class=\"grf-purpose\"><span class=\"grf-kicker\">PURPOSE</span> " + esc(purpose) + "</p>" : "") +
      "<p class=\"grf-deadline\"><span class=\"grf-kicker\">DEADLINE</span> " + (deadline ? esc(fmtDate(deadline)) + " · " +
        (daysLeft >= 0 ? daysLeft + " day" + (daysLeft === 1 ? "" : "s") + " left" : Math.abs(daysLeft) + " day" + (daysLeft === -1 ? "" : "s") + " overdue") +
        (chance != null ? " · set at " + pctText(chance) + " at full focus" : "") : "not set") +
        (plan.extensions ? " · <span class=\"grf-ext\">Extended " + plan.extensions + "×</span>" : "") + "</p>" +
      "<div class=\"grf-overall\">" + bar(progress.percent) + "<span>" + progress.percent + "%</span><span class=\"grf-counts\">" +
        progress.campaigns.done + "/" + progress.campaigns.total + " campaigns · " + progress.operations.done + "/" + progress.operations.total +
        " operations · " + progress.missions.done + "/" + progress.missions.total + " missions</span></div>" +
      nextPanel +
      (pace ? "<p class=\"grf-hours\">Logged " + fmtHours(logged) + " of ~" + fmtHours(forecast.hours.mean) + " · need " + fmtHours(pace.requiredHoursPerWeek) +
        "/week from now" + (pace.projectedFinish ? " · projected finish " + fmtDate(pace.projectedFinish) : "") + "</p>" : "") +
      "</div>";
  }

  function boardBody(goal, plan, o) {
    o = o || {};
    var progress = core.planProgress(plan);
    var snap = plan.deadlineDecision && plan.deadlineDecision.calculationSnapshot;
    var forecast = core.calculateDeadlineForecast(plan, startOf(goal, plan) || today(), { calibration: calibration() });
    var next = core.nextOpenMission(plan);
    var campaignDates = {};
    var dateList = snap && Array.isArray(snap.campaigns) ? snap.campaigns : (forecast.ok ? forecast.campaigns : []);
    dateList.forEach(function (c) { campaignDates[c.id] = c.p50Date; });
    var open = state.open;
    function isOpen(k, dflt) { return open[k] != null ? open[k] : dflt; }
    var campaigns = plan.campaigns.map(function (c, i) {
      var cp = progress.byCampaign[i];
      var ck = "c:" + c.id;
      var cOpen = isOpen(ck, !!(next && next.campaignId === c.id));
      var ops = c.operations.map(function (op, j) {
        var done = op.missions.filter(function (m) { return m.done; }).length;
        var ok = "o:" + op.id;
        var oOpen = isOpen(ok, !!(next && next.operationId === op.id));
        var missions = op.missions.map(function (m, k) {
          var mid = "grf-m-" + op.id + "-" + m.id;
          return "<li><input type=\"checkbox\" id=\"" + esc(mid) + "\"" + (m.done ? " checked" : "") + (o.preview ? " disabled" : "") +
            " onchange=\"" + call("toggleMission", goal.id, c.id, op.id, m.id) + "\"><label for=\"" + esc(mid) + "\"><span class=\"grf-num\">M-" +
            (i + 1) + "." + (j + 1) + "." + (k + 1) + "</span> " + esc(m.text) + "</label></li>";
        }).join("");
        return "<div class=\"grf-op\"><button type=\"button\" class=\"grf-acc\" aria-label=\"" + esc("Operation " + (i + 1) + "." + (j + 1) + ": " + op.title + ", " + done + " of " + op.missions.length + " missions done") + "\" aria-expanded=\"" + oOpen + "\" onclick=\"" + call("toggle", ok, oOpen) + "\">" +
          "<span class=\"grf-num\">OPERATION " + (i + 1) + "." + (j + 1) + "</span> <span class=\"grf-optitle\">" + esc(op.title) + "</span>" +
          bar(op.missions.length ? Math.round(done / op.missions.length * 100) : 0, "", true) + "<span class=\"grf-count\">" + done + "/" + op.missions.length +
          "</span></button>" + (oOpen ? "<ul class=\"grf-missions\">" + missions + "</ul>" : "") + "</div>";
      }).join("");
      return "<div class=\"grf-campaign" + (cp.done ? " done" : "") + "\"><button type=\"button\" class=\"grf-acc grf-acc-campaign\" aria-label=\"" + esc("Campaign " + pad2(i + 1) + ": " + c.title + ", " + cp.percent + "% complete") + "\" aria-expanded=\"" + cOpen +
        "\" onclick=\"" + call("toggle", ck, cOpen) + "\"><span class=\"grf-cnum\">" + pad2(i + 1) + "</span><span class=\"grf-ctitle\"><span class=\"grf-kicker\">CAMPAIGN</span>" +
        esc(c.title) + "</span><span class=\"grf-cdate\">" + (campaignDates[c.id] ? "P50 " + fmtDate(campaignDates[c.id]) : "") + "</span>" +
        bar(cp.percent, "", true) + "<span class=\"grf-count\">" + cp.percent + "%</span></button>" +
        (cOpen ? "<div class=\"grf-campaign-body\"><p class=\"grf-win\"><span class=\"grf-kicker\">WIN RESULT</span> " + esc(c.result) + "</p>" + ops + "</div>" : "") +
        "</div>";
    }).join("");
    if (o.preview) return campaigns;

    var footer = [
      ["research", "Research & unknowns", plan.research.map(function (r) {
        return "<li><b>" + esc(r.question) + "</b> " + esc(r.insight) + " <i>(" + esc(r.source) + ")</i></li>";
      }).join("") + plan.unknowns.map(function (u) { return "<li class=\"grf-unknown\">? " + esc(u) + "</li>"; }).join("")],
      ["deadline", "Deadline decision", plan.deadlineDecision
        ? "<li><b>Why this date:</b> " + esc(plan.deadlineDecision.rationale) + "</li><li><b>Only works if:</b> " + esc(plan.deadlineDecision.assumptions) + "</li>" +
          plan.deadlineHistory.map(function (h) { return "<li>Moved from " + esc(fmtDate(h.date)) + " on " + esc(fmtDate(h.replacedOn)) + ": " + esc(h.postMortem) + "</li>"; }).join("")
        : ""],
      ["obstacles", "Obstacles & counter-moves", plan.obstacles.map(function (x) { return "<li>If " + esc(x.if) + " → " + esc(x.then) + "</li>"; }).join("")],
      ["growth", "Growth", "<li>" + growthBars(plan) + (has(plan.growthNote) ? "<p>" + esc(plan.growthNote) + "</p>" : "") + "</li>"]
    ].map(function (f) {
      var fk = "f:" + f[0];
      var fOpen = isOpen(fk, false);
      return "<div class=\"grf-foot\"><button type=\"button\" class=\"grf-acc\" aria-expanded=\"" + fOpen + "\" onclick=\"" + call("toggle", fk, fOpen) + "\">" +
        esc(f[1]) + "</button>" + (fOpen ? "<ul>" + (f[2] || "<li>Nothing recorded.</li>") + "</ul>" : "") + "</div>";
    }).join("");
    return campaigns + "<div class=\"grf-foots\">" + footer + "</div>";
  }

  function replanPanel(goal, plan) {
    var d = state.confirm.decision;
    var forecast = core.calculateDeadlineForecast(plan, today(), { calibration: calibration(), remainingOnly: true });
    var chosen = core.resolveDeadlineDate(d, today());
    var errors = state.confirm.errors || [];
    return "<div class=\"grf-panel\"><b>Re-plan the deadline</b><p class=\"grf-help\">A missed deadline doesn't free the slot. Learn from it, then set a new coin-flip date.</p>" +
      "<label class=\"grf-field\"><span class=\"grf-label\">Why was the last estimate off?</span><textarea oninput=\"" +
      call("replanSet", "postMortem", raw("this.value")) + "\">" + esc(d.postMortem || "") + "</textarea></label>" +
      "<label class=\"grf-field\"><span class=\"grf-label\">New target date</span><input type=\"date\" value=\"" + esc(d.date || "") + "\" onchange=\"" +
      call("replanSet", "date", raw("this.value,true")) + "\"></label>" +
      renderDeadlineStrip(forecast, chosen) +
      "<label class=\"grf-field\"><span class=\"grf-label\">Why this date?</span><input value=\"" + esc(d.rationale || "") + "\" oninput=\"" +
      call("replanSet", "rationale", raw("this.value")) + "\"></label>" +
      "<label class=\"grf-field\"><span class=\"grf-label\">This only works if…</span><input value=\"" + esc(d.assumptions || "") + "\" oninput=\"" +
      call("replanSet", "assumptions", raw("this.value")) + "\"></label>" +
      (errors.length ? "<div class=\"grf-gate-msg\">" + errors.map(esc).join("<br>") + "</div>" : "") +
      "<div class=\"grf-actions\"><button type=\"button\" class=\"primary\" onclick=\"" + call("confirmReplan", goal.id) + "\">Set new deadline</button>" +
      "<button type=\"button\" onclick=\"" + call("cancelConfirm") + "\">Cancel</button></div></div>";
  }

  function renderBoard(goal) {
    var plan = planOf(goal);
    var legacy = !goal.goalPlan;
    var deadline = deadlineOf(goal, plan);
    var overdue = deadline && core.daysBetween(today(), deadline) < 0;
    var confirm = state.confirm && state.confirm.id === goal.id ? state.confirm : null;
    var logged = host && host.loggedHours ? Number(host.loggedHours(goal.id)) || 0 : 0;

    var replan = "";
    if (overdue) {
      replan = confirm && confirm.kind === "replan" ? replanPanel(goal, plan)
        : "<div class=\"grf-alert\"><b>The deadline passed.</b> This goal stays active until it's completed. Set a new coin-flip deadline to keep going." +
          "<div class=\"grf-actions\"><button type=\"button\" class=\"primary\" onclick=\"" + call("startReplan", goal.id) + "\">Re-plan the deadline</button></div></div>";
    }
    var completePanel = confirm && confirm.kind === "complete"
      ? "<div class=\"grf-panel\"><b>Is the finish line met?</b><p>" + esc(plan.definition || goal.title) + "</p>" +
        "<label class=\"grf-field\"><span class=\"grf-label\">How many focused hours did it actually take?</span>" +
        "<span class=\"grf-help\">You logged " + fmtHours(logged) + ". This makes your next deadlines more accurate.</span>" +
        "<input id=\"grf-actual-hours\" type=\"number\" min=\"0\" step=\"0.5\"></label>" +
        "<div class=\"grf-actions\"><button type=\"button\" class=\"primary\" onclick=\"" + call("confirmComplete", goal.id) + "\">Yes, it's complete</button>" +
        "<button type=\"button\" onclick=\"" + call("cancelConfirm") + "\">Not yet</button></div></div>"
      : "<div class=\"grf-actions grf-complete\"><button type=\"button\" onclick=\"" + call("completeGoal", goal.id) + "\">Complete goal…</button></div>";

    return "<section class=\"grf grf-board\" aria-label=\"Mission Board\">" +
      (state.flash ? "<div class=\"grf-flash\" role=\"status\">" + esc(state.flash) + "</div>" : "") +
      (legacy ? "<div class=\"grf-alert\">This goal was created before the Clarity Gate. <button type=\"button\" class=\"grf-link\" onclick=\"" +
        call("startDefining", goal.id) + "\">Finish defining it →</button></div>" : "") +
      objectiveCard(goal, plan) + replan + boardBody(goal, plan) + completePanel +
      "<nav class=\"grf-quiet\"><button type=\"button\" class=\"grf-link\" onclick=\"" + call("go", "pipeline") + "\">All goals</button>" +
      (host && host.openDaily ? "<button type=\"button\" class=\"grf-link\" onclick=\"GoalReformUI.openDaily()\">Daily goals</button>" : "") +
      (!legacy ? "<button type=\"button\" class=\"grf-link\" onclick=\"" + call("openWorkshop", goal.id, 3) + "\">Edit plan</button>" : "") + "</nav>" +
      "</section>";
  }

  // ------------------------------------------------------------ pipeline + switch-over

  function goalCard(g, body, buttons) {
    return "<div class=\"grf-card grf-goal\"><h4>" + esc(g.title || "Untitled goal") + "</h4>" + body + "<div class=\"grf-actions\">" + buttons + "</div></div>";
  }
  function section(title, body) { return body ? "<h3 class=\"grf-h\">" + esc(title) + "</h3>" + body : ""; }

  function renderPipeline(list) {
    var o = opts();
    var by = { active: [], ready: [], defining: [], backlog: [], done: [] };
    list.forEach(function (g) { var s = core.pipelineStage(g, o); if (by[s]) by[s].push(g); });
    var defBlock = core.definingBlocker(list, o);
    var activeGoal = by.active[0];
    var active = activeGoal
      ? goalCard(activeGoal, "<p>" + esc(planOf(activeGoal).definition || activeGoal.why || "") + "</p>",
        "<button type=\"button\" class=\"primary\" onclick=\"" + call("go", "board") + "\">Open Mission Board</button>")
      : "<p class=\"grf-note\">No active goal. Define one and activate it when it passes the Clarity Gate.</p>";
    var ready = by.ready.map(function (g) {
      var plan = planOf(g);
      var blocker = core.activationBlocker(list, g.id, o);
      var f = core.calculateDeadlineForecast(plan, o.today, { calibration: o.calibration });
      return goalCard(g, "<p>" + esc(plan.definition) + "</p>" + (f.ok ? "<p class=\"grf-help\">Coin-flip date if started today: " + fmtDate(f.dates.p50) + "</p>" : "") + growthBars(plan),
        (blocker ? "<span class=\"grf-blocked\">" + esc(blocker) + "</span>" : "<button type=\"button\" class=\"primary\" onclick=\"" + call("activate", g.id) + "\">Activate</button>") +
        "<button type=\"button\" onclick=\"" + call("openWorkshop", g.id, STAGES.length - 1) + "\">Review</button>");
    }).join("");
    var defining = by.defining.map(function (g) {
      var plan = planOf(g);
      var missing = core.goalPlanReadiness(plan, o).missing;
      var passing = GATE_TOTAL - missing.length;
      var still = missing.slice(0, 2).map(function (m) { return "<li>" + esc(GATE_LABELS[m.key] || m.key) + ": " + esc(m.message) + "</li>"; }).join("");
      return goalCard(g, bar(Math.round(passing / GATE_TOTAL * 100)) + "<p class=\"grf-help\">" + passing + " of " + GATE_TOTAL + " checks pass</p>" +
        (still ? "<ul class=\"grf-still\">" + still + (missing.length > 2 ? "<li>…and " + (missing.length - 2) + " more</li>" : "") + "</ul>" : ""),
        "<button type=\"button\" class=\"primary\" onclick=\"" + call("openWorkshop", g.id, firstOpenStage(plan)) + "\">Continue defining</button>");
    }).join("");
    var backlog = by.backlog.map(function (g) {
      return goalCard(g, "<p class=\"grf-help\">" + esc(g.why || g.description || g.brainstorm || "") + "</p>",
        defBlock ? "<span class=\"grf-blocked\">" + esc(defBlock) + "</span>"
          : "<button type=\"button\" onclick=\"" + call("startDefining", g.id) + "\">Start defining</button>");
    }).join("");
    var done = by.done.map(function (g) { return "<li>✓ " + esc(g.title) + "</li>"; }).join("");
    return "<section class=\"grf grf-pipeline\" aria-label=\"Goals\">" +
      (state.flash ? "<div class=\"grf-flash\" role=\"status\">" + esc(state.flash) + "</div>" : "") +
      "<h3 class=\"grf-h\">Active goal</h3>" + active +
      "<div class=\"grf-new\"><label class=\"grf-field\" for=\"grf-new-title\"><span class=\"grf-label\">New goal</span>" +
      "<span class=\"grf-help\">One line to name it. You'll define it properly next.</span><input id=\"grf-new-title\" placeholder=\"e.g. First $500 month from APEX\"></label>" +
      (defBlock ? "<span class=\"grf-blocked\">" + esc(defBlock) + "</span>" : "<button type=\"button\" class=\"primary\" onclick=\"GoalReformUI.newGoal()\">Start defining</button>") + "</div>" +
      section("Ready to activate", ready) + section("Defining (" + by.defining.length + " of " + core.DEFINING_MAX + ")", defining) +
      section("Backlog", backlog) + (done ? "<details class=\"grf-done\"><summary>Completed (" + by.done.length + ")</summary><ul>" + done + "</ul></details>" : "") +
      (host && host.openDaily ? "<p class=\"grf-note\">Daily goals live in the <button type=\"button\" class=\"grf-link\" onclick=\"GoalReformUI.openDaily()\">Daily</button> tab and run alongside your active goal.</p>" : "") +
      "</section>";
  }

  function renderSwitchOver(list) {
    var actives = core.goalsInStage(list, "active", opts());
    var chosen = state.confirm && state.confirm.kind === "switch" ? state.confirm.id : null;
    var rows = actives.map(function (g) {
      return "<label class=\"grf-switch-row\"><input type=\"radio\" name=\"grf-switch\"" + (chosen === g.id ? " checked" : "") + " onchange=\"" +
        call("chooseSwitch", g.id) + "\"><span><b>" + esc(g.title) + "</b>" + (g.deadline ? " · due " + esc(fmtDate(g.deadline)) : "") +
        "<br><span class=\"grf-help\">" + esc(g.why || g.description || "") + "</span></span></label>";
    }).join("");
    return "<section class=\"grf grf-switch\" aria-label=\"Choose your one active goal\"><span class=\"grf-kicker\">NEW SYSTEM · ONE GOAL</span>" +
      "<h2>Pick the one goal that matters most right now</h2><p class=\"grf-intro\">The new system allows one active goal, and it stays active until you complete it. " +
      "The others move to Backlog, with nothing deleted, and you can define them properly later.</p>" + rows +
      "<div class=\"grf-actions\">" + (chosen
        ? "<button type=\"button\" class=\"primary\" onclick=\"GoalReformUI.confirmSwitch()\">Keep “" + esc((findGoal(chosen) || {}).title) + "” active, move " +
          (actives.length - 1) + " to Backlog</button>"
        : "<span class=\"grf-help\">Choose one goal above.</span>") + "</div></section>";
  }

  function renderActivateConfirm(goal) {
    return "<section class=\"grf grf-confirm\" role=\"dialog\" aria-modal=\"true\" aria-label=\"Confirm activation\"><span class=\"grf-kicker\">ACTIVATE</span>" +
      "<h2>Activate “" + esc(goal.title) + "”?</h2>" +
      "<p>This becomes your only goal. You can't switch to another goal until it's completed.</p><div class=\"grf-actions\">" +
      "<button type=\"button\" class=\"primary\" onclick=\"" + call("confirmActivate", goal.id) + "\">Activate</button>" +
      "<button type=\"button\" onclick=\"" + call("cancelConfirm") + "\">Not yet</button></div></section>";
  }

  // ------------------------------------------------------------ view routing

  function renderView() {
    var list = goals();
    var o = opts();
    if (core.focusResolutionNeeded(list)) return renderSwitchOver(list);
    if (state.confirm && state.confirm.kind === "activate") {
      var target = findGoal(state.confirm.id);
      if (target) return renderActivateConfirm(target);
      state.confirm = null;
    }
    if (state.view === "workshop") {
      var g = findGoal(state.goalId);
      if (g) return renderWorkshop(g, state.stage);
      state.view = "home";
    }
    if (state.view === "pipeline") return renderPipeline(list);
    var active = core.goalsInStage(list, "active", o)[0];
    return active ? renderBoard(active) : renderPipeline(list);
  }

  function render() {
    if (!host || !host.mountEl) return;
    host.mountEl.innerHTML = renderView();
  }

  var LIVE = {
    vague: function (plan, path) { return vagueChips(getPath(plan, path)); },
    sourced: function (plan) { return String(sourcedCount(plan)); },
    deadline: function (plan) { return deadlineLive(plan); },
    gate: function (plan) { return gateList(plan); },
    stagecheck: function (plan) { return stageCheck(stageCheckMissing(plan, state.stage), stageDone(plan, state.stage)); }
  };

  // Update only the live check areas so typing never loses focus or cursor position.
  function refreshLive(id) {
    var el = host && host.mountEl;
    if (!el || typeof el.querySelectorAll !== "function") return;
    var plan = core.normalizeGoalPlan(draftFor(id));
    Array.prototype.forEach.call(el.querySelectorAll("[data-live]"), function (node) {
      var fn = LIVE[node.getAttribute("data-live")];
      if (fn) node.innerHTML = fn(plan, node.getAttribute("data-arg"));
    });
    var nextBtn = el.querySelector(".grf-next-btn");
    if (nextBtn) nextBtn.disabled = !(STAGES[state.stage].skippable || stageDone(plan, state.stage));
    Array.prototype.forEach.call(el.querySelectorAll(".grf-rail-step"), function (btn, i) {
      var done = stageDone(plan, i);
      btn.classList.toggle("done", done);
      btn.textContent = (done ? "✓ " : "") + STAGES[i].name;
      btn.disabled = !canEnter(plan, i);
    });
  }

  // ------------------------------------------------------------ actions (called from inline handlers)

  function structural(id, fn) {
    var plan = draftFor(id);
    fn(plan);
    state.drafts[id] = clone(core.normalizeGoalPlan(plan));
    flush(id);
    render();
  }
  function flash(message) { state.flash = message; render(); return false; }
  function okResult(res) { return res === true || !!(res && res.ok); }

  var actions = {
    mount: function (adapter) {
      host = adapter;
      state = freshState();
      injectStyles();
      render();
      return actions;
    },
    render: render,
    renderView: renderView,
    refresh: function () { state.drafts = {}; render(); },
    go: function (view) {
      if (state.goalId) flush(state.goalId);
      state.view = view === "board" ? "home" : view;
      state.confirm = null;
      state.flash = "";
      render();
    },
    openWorkshop: function (id, stage) {
      state.view = "workshop"; state.goalId = id; state.confirm = null; state.flash = "";
      var plan = planOf(findGoal(id));
      var target = stage == null ? firstOpenStage(plan) : stage;
      state.stage = canEnter(plan, target) ? target : firstOpenStage(plan);
      render();
    },
    stageTo: function (i) {
      var plan = planOf(findGoal(state.goalId));
      if (!canEnter(plan, i)) return;
      flush(state.goalId);
      state.stage = i;
      render();
    },
    set: function (path, value, kind) {
      var id = state.goalId;
      if (!id) return;
      setPath(draftFor(id), path, coerce(value, kind));
      scheduleSave(id);
      refreshLive(id);
    },
    pick: function (path, value) {
      structural(state.goalId, function (plan) { setPath(plan, path, value); });
    },
    addCampaign: function () {
      structural(state.goalId, function (plan) {
        if (plan.campaigns.length >= core.CAMPAIGNS_MAX) return;
        plan.campaigns.push({ id: uid("c"), title: "", result: "", estimate: {}, operations: [{ id: uid("o"), title: "", missions: [{ id: uid("m"), text: "", done: false }] }] });
      });
    },
    addOperation: function (ci) {
      structural(state.goalId, function (plan) { plan.campaigns[ci].operations.push({ id: uid("o"), title: "", missions: [{ id: uid("m"), text: "", done: false }] }); });
    },
    addMission: function (ci, oi) {
      structural(state.goalId, function (plan) { plan.campaigns[ci].operations[oi].missions.push({ id: uid("m"), text: "", done: false }); });
      var el = host.mountEl;
      if (el && el.querySelector) {
        var inputs = el.querySelectorAll("[aria-label^=\"Mission " + (ci + 1) + "." + (oi + 1) + ".\"]");
        if (inputs.length) inputs[inputs.length - 1].focus();
      }
    },
    addFinding: function (question) {
      structural(state.goalId, function (plan) { plan.research.push({ id: uid("r"), question: question || "", source: "", insight: "" }); });
    },
    addObstacle: function () {
      structural(state.goalId, function (plan) { plan.obstacles.push({ if: "", then: "" }); });
    },
    removeItem: function (listPath, index) {
      structural(state.goalId, function (plan) { var list = getPath(plan, listPath); if (Array.isArray(list)) list.splice(index, 1); });
    },
    moveItem: function (listPath, index, dir) {
      structural(state.goalId, function (plan) {
        var list = getPath(plan, listPath), to = index + dir;
        if (!Array.isArray(list) || to < 0 || to >= list.length) return;
        list.splice(to, 0, list.splice(index, 1)[0]);
      });
    },
    newGoal: function (titleArg) {
      var input = host.mountEl && host.mountEl.querySelector ? host.mountEl.querySelector("#grf-new-title") : null;
      var title = String(titleArg != null ? titleArg : (input ? input.value : "")).trim();
      if (!title) return flash("Name the goal in one line first.");
      var blocker = core.definingBlocker(goals(), opts());
      if (blocker) return flash(blocker);
      var g = host.createGoal(title);
      if (!g) return flash("The goal couldn't be created.");
      host.saveGoal(Object.assign({}, g, { goalPlan: core.normalizeGoalPlan({}) }));
      actions.openWorkshop(g.id, 0);
      return g;
    },
    startDefining: function (id) {
      var g = findGoal(id);
      if (!g) return false;
      var isActive = core.pipelineStage(g, opts()) === "active";
      if (!isActive && !g.goalPlan) {
        var blocker = core.definingBlocker(goals(), opts());
        if (blocker) return flash(blocker);
      }
      if (!g.goalPlan) {
        // Carry the user's own earlier words over as a starting point; nothing is invented.
        var seed = { whyLayers: [g.why || g.description || "", "", ""], currentReality: g.startingPoint || g.start || "" };
        if (isActive) seed.activatedOn = g.reformFocusSince || today();
        var update = { goalPlan: core.normalizeGoalPlan(seed) };
        if (!isActive) update.archivedAt = null;
        host.saveGoal(Object.assign({}, g, update));
      }
      delete state.drafts[id];
      actions.openWorkshop(id, 0);
      return true;
    },
    activate: function (id) {
      if (state.goalId) flush(state.goalId);
      var blocker = core.activationBlocker(goals(), id, opts());
      if (blocker) { state.view = "pipeline"; return flash(blocker); }
      state.confirm = { kind: "activate", id: id };
      state.flash = "";
      render();
      return true;
    },
    confirmActivate: function (id, activationOpts) {
      var g = findGoal(id);
      if (!g) return Promise.resolve(false);
      // The host must judge with the same today + calibration the screens used,
      // or the gate and the lock can disagree about the same deadline.
      var checkOpts = Object.assign(opts(), activationOpts || {});
      var blocker = core.activationBlocker(goals(), id, checkOpts);
      if (blocker) { state.confirm = null; state.view = "pipeline"; flash(blocker); return Promise.resolve(false); }
      var plan = clone(Object.assign({}, planOf(g), { activatedOn: today() }));
      var deadline = plan.deadlineDecision ? core.resolveDeadlineDate(plan.deadlineDecision, today()) : "";
      // Freeze a duration choice into its date so the deadline never drifts with "today".
      if (plan.deadlineDecision && deadline) plan.deadlineDecision = Object.assign({}, plan.deadlineDecision, { inputMode: "date", date: deadline });
      commitSnapshot(id, plan, false);
      var updated = Object.assign({}, g, { goalPlan: plan });
      if (deadline) updated.deadline = deadline;
      host.saveGoal(updated);
      delete state.drafts[id];
      return Promise.resolve(host.activate(id, checkOpts)).then(function (res) {
        var ok = okResult(res);
        state.confirm = null;
        state.view = ok ? "home" : "pipeline";
        state.flash = ok ? "" : ((res && res.message) || "Activation didn't go through. Try again.");
        render();
        return ok;
      });
    },
    cancelConfirm: function () { state.confirm = null; render(); },
    toggle: function (k, wasOpen) {
      var current = state.open[k] != null ? state.open[k] : !!wasOpen;
      state.open[k] = !current;
      render();
    },
    toggleMission: function (goalId, cId, oId, mId) {
      var g = findGoal(goalId);
      if (!g) return;
      var plan = clone(planOf(g));
      plan.campaigns.forEach(function (c) {
        if (c.id !== cId) return;
        c.operations.forEach(function (o) {
          if (o.id !== oId) return;
          o.missions.forEach(function (m) {
            if (m.id !== mId) return;
            m.done = !m.done;
            m.completedOn = m.done ? today() : null;
          });
        });
      });
      delete state.drafts[goalId];
      host.saveGoal(Object.assign({}, g, { goalPlan: plan }));
      render();
    },
    nextActionDone: function (id) { state.confirm = { kind: "next", id: id }; render(); },
    saveNextAction: function (id, textArg, minutesArg) {
      var el = host.mountEl;
      var text = String(textArg != null ? textArg : el.querySelector("#grf-next-text").value).trim();
      var mins = Number(minutesArg != null ? minutesArg : el.querySelector("#grf-next-min").value);
      var error = !text ? "Write the next action." :
        !(mins > 0 && mins <= core.NEXT_ACTION_MAX_MINUTES) ? "Keep it to 30 minutes or less. Break it down if it's bigger." : "";
      if (error) { state.confirm = { kind: "next", id: id, error: error }; render(); return false; }
      var g = findGoal(id);
      var plan = clone(planOf(g));
      plan.completedActions = (Array.isArray(plan.completedActions) ? plan.completedActions : [])
        .concat(has(plan.nextAction.text) ? [{ text: plan.nextAction.text, doneOn: today() }] : []);
      plan.nextAction = { text: text, minutes: mins };
      delete state.drafts[id];
      host.saveGoal(Object.assign({}, g, { goalPlan: plan }));
      state.confirm = null;
      render();
      return true;
    },
    completeGoal: function (id) { state.confirm = { kind: "complete", id: id }; render(); },
    confirmComplete: function (id, hoursArg) {
      var g = findGoal(id);
      if (!g) return Promise.resolve(false);
      var input = host.mountEl && host.mountEl.querySelector ? host.mountEl.querySelector("#grf-actual-hours") : null;
      var hours = Number(hoursArg != null ? hoursArg : (input && input.value));
      var plan = clone(planOf(g));
      if (hours > 0) plan.actualHours = hours;
      plan.completedOn = today();
      delete state.drafts[id];
      host.saveGoal(Object.assign({}, g, { goalPlan: plan }));
      return Promise.resolve(host.complete(id)).then(function (res) {
        var ok = okResult(res);
        state.confirm = null;
        state.view = ok ? "pipeline" : "home";
        state.flash = ok ? "Completed. Choose what's next." : ((res && res.message) || "Completion didn't go through. Try again.");
        render();
        return ok;
      });
    },
    startReplan: function (id) { state.confirm = { kind: "replan", id: id, decision: { inputMode: "date" }, errors: [] }; render(); },
    replanSet: function (k, value, rerender) {
      if (!state.confirm || state.confirm.kind !== "replan") return;
      state.confirm.decision[k] = value;
      if (rerender) render();
    },
    confirmReplan: function (id) {
      var g = findGoal(id);
      if (!g || !state.confirm || state.confirm.kind !== "replan") return false;
      var res = core.replanDeadline(planOf(g), state.confirm.decision, today(), { calibration: calibration() });
      if (!res.ok) { state.confirm.errors = res.errors; render(); return false; }
      var plan = commitSnapshot(id, Object.assign({}, res.plan, { activatedOn: today() }), true);
      delete state.drafts[id];
      host.saveGoal(Object.assign({}, g, { goalPlan: plan, deadline: core.resolveDeadlineDate(plan.deadlineDecision, today()) }));
      state.confirm = null;
      render();
      return true;
    },
    chooseSwitch: function (id) { state.confirm = { kind: "switch", id: id }; render(); },
    confirmSwitch: function () {
      if (!state.confirm || state.confirm.kind !== "switch") return false;
      var keep = state.confirm.id;
      var t = today();
      core.goalsInStage(goals(), "active", opts()).forEach(function (g) {
        if (g.id === keep) { host.saveGoal(Object.assign({}, g, { reformFocusSince: t })); return; }
        host.saveGoal(Object.assign({}, g, { goalType: "future", status: "needsPlanning", reformSwitchOver: { from: "active", on: t } }));
      });
      state.confirm = null;
      state.view = "home";
      render();
      return true;
    },
    copyReview: function (id) {
      var g = findGoal(id);
      var plan = planOf(g);
      var text = "Do not rewrite my goal. Ask me up to 5 hard questions that expose vagueness, missing research, or unrealistic estimates.\n\n" +
        "GOAL: " + (g.title || "") + "\nFINISH LINE: " + plan.definition + "\nPROOF: " + plan.successEvidence + "\nNOT: " + plan.exclusions +
        "\nWHY: " + plan.whyLayers.join(" -> ") + "\nRESEARCH:\n" + plan.research.map(function (r) { return "- " + r.question + ": " + r.insight + " (" + r.source + ")"; }).join("\n") +
        "\nCAMPAIGNS:\n" + plan.campaigns.map(function (c, i) {
          return (i + 1) + ". " + c.title + " | WIN: " + c.result + " | hours best/likely/worst " + [c.estimate.best, c.estimate.likely, c.estimate.worst].join("/");
        }).join("\n") + "\nCAPACITY: " + plan.capacity.hoursPerWeek + " h/week\nDEADLINE: " + (plan.deadlineDecision ? core.resolveDeadlineDate(plan.deadlineDecision, today()) : "");
      if (host.copyText) host.copyText(text);
      else if (typeof navigator !== "undefined" && navigator.clipboard) navigator.clipboard.writeText(text);
      flash("Copied. Paste it into an AI, and answer its questions yourself.");
      return text;
    },
    openDaily: function () { if (host && host.openDaily) host.openDaily(); },
    _state: function () { return state; }
  };

  // ------------------------------------------------------------ styles

  function injectStyles() {
    if (typeof document === "undefined" || !document.head || document.getElementById("grf-styles")) return;
    var style = document.createElement("style");
    style.id = "grf-styles";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  var CSS = [
    ".grf{max-width:920px;margin:0 auto;color:var(--text)}",
    ".grf h2{margin:4px 0 8px;font-size:20px;line-height:1.3}",
    ".grf h3{margin:0 0 4px;font-size:17px}",
    ".grf-h{margin:22px 0 8px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold)}",
    ".grf-kicker{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--gold);font-weight:700}",
    ".grf-intro,.grf-help,.grf-note{color:var(--text2);font-size:13px}",
    ".grf-help{display:block;margin:2px 0 4px}",
    ".grf-card{background:linear-gradient(135deg,var(--canvas),var(--soft2));border:1px solid var(--border);border-radius:4px;padding:14px;margin:10px 0}",
    ".grf-field{display:block;margin:12px 0}",
    ".grf-label{display:block;font-weight:700;font-size:13px}",
    ".grf-field input,.grf-field textarea,.grf-mission-edit input{width:100%;box-sizing:border-box;background:var(--soft);color:var(--text);border:1px solid var(--border);border-radius:3px;padding:8px;font:inherit}",
    ".grf-field textarea{resize:vertical}",
    ".grf-chip{display:inline-block;margin:6px 6px 0 0;padding:2px 8px;border-radius:10px;background:var(--goldBg);color:var(--gold);font-size:12px}",
    ".grf-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}",
    ".grf-rail{display:flex;gap:4px;flex-wrap:wrap;margin:10px 0 18px}",
    ".grf-rail-step{flex:1 1 90px;font-size:12px;padding:6px 8px}",
    ".grf-rail-step.current{border-color:var(--gold);color:var(--gold)}",
    ".grf-rail-step.done{color:var(--green)}",
    ".grf-rail-step:disabled{opacity:.45;cursor:not-allowed}",
    ".grf-stage{border:1px solid var(--border);border-radius:4px;padding:16px;background:var(--canvas)}",
    ".grf-nav,.grf-actions{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:14px;align-items:center}",
    ".grf-actions{justify-content:flex-start}",
    ".grf button:disabled{opacity:.45;cursor:not-allowed}",
    ".grf-gate-msg{margin-top:12px;padding:10px 12px;border-left:3px solid var(--red);background:var(--redBg);font-size:13px}",
    ".grf-ok{margin-top:12px;padding:8px 12px;border-left:3px solid var(--green);background:var(--greenBg);font-size:13px}",
    ".grf-blocked{color:var(--text2);font-size:13px;font-style:italic}",
    ".grf-flash{padding:10px 12px;border:1px solid var(--gold);background:var(--goldBg);margin-bottom:12px}",
    ".grf-link{background:none;border:0;color:var(--blue);padding:2px 6px;font-weight:600;cursor:pointer}",
    ".grf-small{font-size:12px;padding:4px 10px}",
    ".grf-row-head{display:flex;justify-content:space-between;align-items:center;gap:8px}",
    ".grf-num{font-size:11px;color:var(--text2);letter-spacing:.06em}",
    ".grf-est-row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}",
    ".grf-est-row .grf-field{margin:4px 0}",
    ".grf-op-edit{border-left:2px solid var(--border);padding-left:10px;margin:10px 0}",
    ".grf-mission-edit{display:flex;gap:6px;align-items:center;margin:4px 0}",
    ".grf-mission-edit .grf-num{min-width:56px}",
    ".grf-prompts{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:10px 0}",
    ".grf-prompt{font-size:12px;font-weight:400;color:var(--text2);border-style:dashed}",
    ".grf-counter{font-weight:700}",
    ".grf-toggle{display:flex;gap:6px;margin:12px 0}",
    ".grf-toggle .on,.grf-seg .on{background:var(--gold);border-color:var(--gold);color:var(--soft)}",
    ".grf-quote{margin:0 0 12px;padding:8px 12px;border-left:3px solid var(--gold);color:var(--text2);font-style:italic}",
    ".grf-strip{margin:18px 0 8px;padding:40px 12% 52px}",
    ".grf-track{position:relative;height:8px;background:var(--soft2);border:1px solid var(--border);border-radius:4px}",
    ".grf-band{position:absolute;top:-4px;bottom:-4px;background:var(--goldBg);border:1px solid var(--gold);border-radius:4px}",
    ".grf-mark{position:absolute;top:16px;transform:translateX(-50%);font-size:11px;text-align:center;white-space:nowrap;line-height:1.25}",
    ".grf-mark span{display:block;font-weight:700}.grf-mark b{display:block;font-weight:400}.grf-mark i{display:block;color:var(--text2)}",
    ".grf-mark-p10 span{color:var(--red)}.grf-mark-p50 span{color:var(--gold)}.grf-mark-p90 span{color:var(--text2)}",
    ".grf-mark-p50{top:auto;bottom:16px}",
    ".grf-mark-p10{transform:translateX(-100%);text-align:right;padding-right:4px;border-right:1px solid var(--red)}",
    ".grf-mark-p90{transform:none;text-align:left;padding-left:4px;border-left:1px solid var(--text2)}",
    ".grf-pin{position:absolute;top:-10px;width:4px;height:26px;margin-left:-2px;background:var(--text);box-shadow:0 0 0 2px var(--soft)}",
    ".grf-pin-beyond span{position:absolute;left:8px;top:-20px;white-space:nowrap;font-size:11px;font-weight:700}",
    ".grf-yourdate{font-size:14px}",
    ".grf-campaign-dates{font-size:12px;color:var(--text2);padding-left:18px}",
    ".grf-strip-empty{padding:12px;border:1px dashed var(--border);color:var(--text2);font-size:13px;margin:12px 0}",
    ".grf-growth-row{display:flex;align-items:center;gap:12px;margin:8px 0}",
    ".grf-growth-row .grf-label{width:120px}",
    ".grf-seg{display:flex;gap:4px}.grf-seg button{width:38px;padding:6px 0}",
    ".grf-growth-bars div{display:grid;grid-template-columns:110px 1fr 24px;gap:8px;align-items:center;font-size:12px;margin:3px 0}",
    ".grf-gate{list-style:none;padding:0;margin:0}",
    ".grf-gate li{padding:6px 0;border-bottom:1px solid var(--border);font-size:13px}",
    ".grf-gate li.good .grf-link{color:var(--green)}.grf-gate li.bad .grf-link{color:var(--red)}",
    ".grf-gate li span{display:block;color:var(--text2);padding-left:22px}",
    ".grf-preview{border:1px dashed var(--border);padding:10px;border-radius:4px}",
    ".grf-bar{display:block;flex:1;height:6px;background:var(--soft2);border:1px solid var(--border);border-radius:3px;overflow:hidden;min-width:60px}",
    ".grf-bar span{display:block;height:100%;background:var(--accent)}",
    ".grf-bar-gold span{background:var(--gold)}",
    ".grf-objective{border:1px solid var(--border);border-top:3px solid var(--gold);border-radius:4px;padding:18px;background:linear-gradient(135deg,var(--canvas),var(--soft2));box-shadow:0 10px 30px rgba(0,0,0,.22);margin-bottom:12px}",
    ".grf-objective h2{font-size:22px}",
    ".grf-purpose,.grf-deadline{margin:6px 0;font-size:14px}",
    ".grf-ext{color:var(--red);font-weight:700}",
    ".grf-overall{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0;font-size:13px}",
    ".grf-overall .grf-bar{height:10px}",
    ".grf-counts{color:var(--text2);font-size:12px}",
    ".grf-next{border:1px solid var(--gold);background:var(--goldBg);border-radius:4px;padding:12px;margin-top:10px}",
    ".grf-next p{margin:6px 0 0;font-size:16px;font-weight:700}",
    ".grf-hours{font-size:12px;color:var(--text2);margin:10px 0 0}",
    ".grf-pace{font-size:12px;font-weight:700;letter-spacing:.1em;padding:3px 10px;border-radius:10px;border:1px solid currentColor}",
    ".grf-pace-on-pace,.grf-pace-ahead{color:var(--green)}.grf-pace-behind{color:var(--gold)}.grf-pace-overdue{color:var(--red)}",
    ".grf-campaign{border:1px solid var(--border);border-radius:4px;margin:8px 0;background:var(--canvas)}",
    ".grf-campaign.done{opacity:.75}",
    ".grf-acc{display:flex;width:100%;align-items:center;gap:10px;text-align:left;border:0;background:transparent;padding:10px 12px;font-weight:600;color:var(--text)}",
    ".grf-acc:after{content:'\\25B8';margin-left:4px;color:var(--text2)}.grf-acc[aria-expanded=true]:after{content:'\\25BE'}",
    ".grf-cnum{font-size:18px;color:var(--gold);font-weight:700;min-width:28px}",
    ".grf-ctitle{flex:2;display:flex;flex-direction:column}",
    ".grf-optitle{flex:2}",
    ".grf-cdate{font-size:12px;color:var(--text2);white-space:nowrap}",
    ".grf-count{font-size:12px;color:var(--text2);min-width:36px;text-align:right}",
    ".grf-campaign-body{padding:0 12px 10px 50px}",
    ".grf-win{margin:0 0 8px;font-size:13px}",
    ".grf-op{border-left:2px solid var(--border);margin:4px 0}",
    ".grf-missions{list-style:none;padding:0 0 6px 18px;margin:0}",
    ".grf-missions li{display:flex;gap:8px;align-items:flex-start;padding:3px 0;font-size:13px}",
    ".grf-foots{margin-top:12px}",
    ".grf-foot{border-top:1px solid var(--border)}.grf-foot ul{font-size:13px;padding-left:28px}",
    ".grf-unknown{color:var(--gold)}",
    ".grf-alert{border:1px solid var(--red);background:var(--redBg);padding:12px;border-radius:4px;margin:10px 0}",
    ".grf-panel{border:1px solid var(--gold);padding:12px;border-radius:4px;margin:10px 0;background:var(--canvas)}",
    ".grf-complete{justify-content:flex-end}",
    ".grf-quiet{display:flex;gap:10px;margin-top:18px;opacity:.8}",
    ".grf-goal h4{margin:0 0 6px}",
    ".grf-still{font-size:12px;color:var(--text2);padding-left:18px;margin:6px 0 0}",
    ".grf-new{border:1px dashed var(--border);border-radius:4px;padding:12px;margin:14px 0}",
    ".grf-switch-row{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--border);border-radius:4px;padding:12px;margin:8px 0;cursor:pointer}",
    ".grf-confirm{border:1px solid var(--gold);border-radius:4px;padding:18px;background:var(--canvas)}",
    "@media (max-width:640px){.grf-est-row{grid-template-columns:1fr}.grf-campaign-body{padding-left:14px}.grf-cdate{display:none}.grf-growth-row{flex-wrap:wrap}.grf-strip{padding-left:18%;padding-right:18%}}"
  ].join("\n");

  actions.STAGES = STAGES;
  actions.renderWorkshop = function (goal, stage) { return renderWorkshop(goal, stage || 0); };
  actions.renderBoard = renderBoard;
  actions.renderPipeline = renderPipeline;
  actions.renderSwitchOver = renderSwitchOver;
  actions.renderDeadlineStrip = renderDeadlineStrip;
  actions.CSS = CSS;
  return actions;
});
