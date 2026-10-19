import {
  GLYPH, VALUE, freshState, copyState, colorOf, kind, sqName, moveKey, inCheck,
  legalMoves, makeMove, scoreMoves, difficultyProfile, gradingProfile,
  gradeMove, statusOf, notation
} from "./chess.js";
import { initPwa } from "./pwa.js";

let state;
let undoStack = [];
let selected = null;
let legalForSelection = [];
let hintMove = null;
let flipped = false;
let busy = false;
let busyReason = "opponent";
let pendingPromotion = null;
let difficulty = 3;
let opponentMode = "manual";
let opponentTheme = "balanced";
let timeControlId = "none";
let analysisOptions = { ...DEFAULT_ANALYSIS_OPTIONS };
let clock = { w: 0, b: 0 };
let clockHandle = null;
let lastClockAt = 0;
let lastClockSavedAt = 0;
let clockEndStatus = null;
let adaptiveLosses = [];
let hintTimer = null;
let focusSquare = 52;
let gameEpoch = 0;
let analysisWorker = null;
let requestSequence = 0;
const pendingAnalyses = new Map();

const $ = id => document.getElementById(id);
const STORAGE_KEY = "kashmat.saved-game.v1";
const PIECES = "PNBRQKpnbrqk";
const TIME_CONTROLS = {
  none: { label: "دون مؤقّت", minutes: 0, increment: 0 },
  "1+0": { label: "١ دقيقة", minutes: 1, increment: 0 },
  "3+0": { label: "٣ دقائق", minutes: 3, increment: 0 },
  "3+2": { label: "٣ + ٢", minutes: 3, increment: 2 },
  "5+0": { label: "٥ دقائق", minutes: 5, increment: 0 },
  "10+0": { label: "١٠ دقائق", minutes: 10, increment: 0 },
  "15+10": { label: "١٥ + ١٠", minutes: 15, increment: 10 },
  "30+0": { label: "٣٠ دقيقة", minutes: 30, increment: 0 }
};
const DEFAULT_ANALYSIS_OPTIONS = {
  evaluationBar: true,
  threatArrows: false,
  suggestionArrows: true,
  moveEvaluation: true,
  engine: false
};
const THEME_NAMES = { balanced: "متوازن", aggressive: "هجومي", tactical: "تكتيكي", defensive: "دفاعي" };
const GROUP_LEVELS = { beginner: 1, intermediate: 3, advanced: 5, master: 7, adaptive: 3 };
const GRADE_COLORS = {
  "حركة مبهرة": "#83c99e", "حركة ممتازة جداً": "#83c99e", "حركة ممتازة": "#83c99e",
  "حركة جيدة جداً": "#9bcf9a", "حركة جيدة": "#b8ce83", "حركة عادية": "#b8ce83",
  "حركة مقبولة": "#edc26a", "حركة سيئة": "#edb36a", "حركة سيئة جداً": "#ed9b72",
  "حركة فاشلة": "#e98572", "حركة فاشلة جداً": "#e97d72"
};

function validSavedState(candidate) {
  return Boolean(candidate && Array.isArray(candidate.board) && candidate.board.length === 64
    && candidate.board.every(piece => piece === null || PIECES.includes(piece))
    && ["w", "b"].includes(candidate.turn)
    && typeof candidate.castling === "string"
    && (candidate.ep === null || Number.isInteger(candidate.ep) && candidate.ep >= 0 && candidate.ep < 64)
    && Number.isInteger(candidate.half) && candidate.half >= 0
    && Number.isInteger(candidate.full) && candidate.full >= 1
    && Array.isArray(candidate.moves)
    && candidate.moves.every(move => move && typeof move.san === "string" && ["w", "b"].includes(move.actor))
    && candidate.captured && Array.isArray(candidate.captured.w) && Array.isArray(candidate.captured.b)
    && candidate.captured.w.every(piece => PIECES.includes(piece))
    && candidate.captured.b.every(piece => PIECES.includes(piece))
    && candidate.counts && typeof candidate.counts === "object"
    && Number.isFinite(candidate.evalWhite));
}

function persistGame() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state,
      undoStack,
      difficulty,
      settings: { opponentMode, opponentTheme, timeControlId, analysisOptions },
      clock
    }));
  } catch (error) {
    console.warn("Could not save this game locally", error);
  }
}

function restoreGame() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return false;
    const settings = saved.settings || {};
    difficulty = Number.isInteger(saved.difficulty) && saved.difficulty >= 1 && saved.difficulty <= 7 ? saved.difficulty : 3;
    opponentMode = settings.opponentMode === "adaptive" ? "adaptive" : "manual";
    opponentTheme = Object.hasOwn(THEME_NAMES, settings.opponentTheme) ? settings.opponentTheme : "balanced";
    timeControlId = Object.hasOwn(TIME_CONTROLS, settings.timeControlId) ? settings.timeControlId : "none";
    analysisOptions = { ...DEFAULT_ANALYSIS_OPTIONS };
    for (const key of Object.keys(analysisOptions)) {
      if (typeof settings.analysisOptions?.[key] === "boolean") analysisOptions[key] = settings.analysisOptions[key];
    }
    const startingTime = TIME_CONTROLS[timeControlId].minutes * 60 * 1000;
    clock = {
      w: Number.isFinite(saved.clock?.w) && saved.clock.w >= 0 ? saved.clock.w : startingTime,
      b: Number.isFinite(saved.clock?.b) && saved.clock.b >= 0 ? saved.clock.b : startingTime
    };
    if (!validSavedState(saved.state)) return false;
    state = saved.state;
    undoStack = Array.isArray(saved.undoStack) ? saved.undoStack.filter(validSavedState) : [];
    return true;
  } catch {
    return false;
  }
}

function getGameStatus() {
  return clockEndStatus || statusOf(state);
}

function formatClock(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function renderClock() {
  const timed = timeControlId !== "none";
  for (const color of ["w", "b"]) {
    const element = $(color === "w" ? "clock-white" : "clock-black");
    element.hidden = !timed;
    element.textContent = formatClock(clock[color]);
    element.setAttribute("aria-label", `وقت ${color === "w" ? "الأبيض" : "الأسود"}: ${formatClock(clock[color])}`);
    element.classList.toggle("active", timed && state.turn === color && !clockEndStatus);
    element.classList.toggle("low-time", timed && clock[color] <= 10_000);
  }
}

function stopClock() {
  if (clockHandle !== null) clearInterval(clockHandle);
  clockHandle = null;
  lastClockAt = 0;
}

function finishOnTime(color) {
  stopClock();
  clockEndStatus = {
    over: true,
    title: "انتهى الوقت",
    detail: color === "w" ? "انتهى وقتك — فاز الخصم بالقطع السوداء" : "انتهى وقت الخصم — فزت!",
    icon: color === "w" ? "♟" : "♔"
  };
  busy = false;
  gameEpoch++;
  resetAnalysisWorker();
  render();
  showEnd(clockEndStatus);
  persistGame();
}

function tickClock() {
  if (clockHandle === null || !lastClockAt || clockEndStatus || timeControlId === "none") return;
  const now = Date.now();
  const elapsed = Math.max(0, now - lastClockAt);
  lastClockAt = now;
  const active = state.turn;
  clock[active] = Math.max(0, clock[active] - elapsed);
  renderClock();
  if (clock[active] <= 0) return finishOnTime(active);
  if (now - lastClockSavedAt >= 1000) {
    lastClockSavedAt = now;
    persistGame();
  }
}

function startClock() {
  stopClock();
  renderClock();
  if (timeControlId === "none" || getGameStatus().over) return;
  lastClockAt = Date.now();
  lastClockSavedAt = lastClockAt;
  clockHandle = setInterval(tickClock, 200);
}

function pauseClock() {
  if (clockHandle !== null) tickClock();
  stopClock();
  persistGame();
}

function applyAnalysisOptions() {
  $("eval-wrap").hidden = !analysisOptions.evaluationBar;
  $("mobile-eval").hidden = !analysisOptions.evaluationBar;
  $("grade-row").hidden = !analysisOptions.moveEvaluation;
  $("engine-panel").hidden = !analysisOptions.engine;
}

function syncSetupUI() {
  $("setup-difficulty").value = String(difficulty);
  document.querySelectorAll("[data-group]").forEach(button => {
    let selected = false;
    if (opponentMode === "adaptive") selected = button.dataset.group === "adaptive";
    else if (button.dataset.group === "beginner") selected = difficulty <= 2;
    else if (button.dataset.group === "intermediate") selected = difficulty === 3;
    else if (button.dataset.group === "advanced") selected = difficulty >= 4 && difficulty <= 5;
    else if (button.dataset.group === "master") selected = difficulty >= 6;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll("[data-theme]").forEach(button => {
    const selected = button.dataset.theme === opponentTheme;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll("[data-time]").forEach(button => {
    const selected = button.dataset.time === timeControlId;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  $("adaptive-note").hidden = opponentMode !== "adaptive";
  for (const [id, key] of [["option-eval-bar", "evaluationBar"], ["option-threats", "threatArrows"], ["option-suggestions", "suggestionArrows"], ["option-move-eval", "moveEvaluation"], ["option-engine", "engine"]]) {
    $(id).checked = analysisOptions[key];
  }
}

function updateOpponentLabel() {
  const levelName = difficultyProfile(difficulty).name;
  $("opponent-sub").textContent = opponentMode === "adaptive"
    ? `متكيّف · المستوى الحالي ${levelName}`
    : `${levelName} · ${THEME_NAMES[opponentTheme]}`;
}

function settlePendingAnalyses(value = null) {
  for (const request of pendingAnalyses.values()) request.resolve(value);
  pendingAnalyses.clear();
}

function resetAnalysisWorker() {
  if (analysisWorker) analysisWorker.terminate();
  analysisWorker = null;
  settlePendingAnalyses(null);
}

function getAnalysisWorker() {
  if (analysisWorker) return analysisWorker;
  try {
    analysisWorker = new Worker(new URL("./engine-worker.js", import.meta.url), { type: "module" });
    analysisWorker.onmessage = event => {
      const request = pendingAnalyses.get(event.data?.id);
      if (!request) return;
      pendingAnalyses.delete(event.data.id);
      request.resolve(request.epoch === gameEpoch && !event.data.error ? event.data.scores : null);
    };
    analysisWorker.onerror = error => {
      console.error("Chess analysis worker failed", error);
      resetAnalysisWorker();
    };
    return analysisWorker;
  } catch (error) {
    console.error("Could not start chess analysis worker", error);
    return null;
  }
}

function analyze(position, level, limits, epoch = gameEpoch) {
  const worker = getAnalysisWorker();
  if (!worker) {
    // Keep the interface responsive even if a browser blocks module workers.
    return Promise.resolve(scoreMoves(position, 1, { maxNodes: 180, maxTimeMs: 25 }));
  }
  const id = ++requestSequence;
  return new Promise(resolve => {
    pendingAnalyses.set(id, { resolve, epoch });
    worker.postMessage({ id, state: copyState(position), depth: limits.depth, maxNodes: limits.maxNodes, maxTimeMs: limits.maxTimeMs });
  });
}

function gradeFor(scores, move) {
  const selectedScore = scores?.find(item => moveKey(item.move) === moveKey(move))?.score;
  const bestScore = scores?.[0]?.score;
  const loss = Number.isFinite(selectedScore) && Number.isFinite(bestScore)
    ? Math.max(0, bestScore - selectedScore) : 0;
  return { grade: gradeMove(loss), loss, score: Number.isFinite(selectedScore) ? selectedScore : (bestScore || 0) };
}

function showGrade(grade, loss) {
  $("grade-icon").textContent = grade.icon;
  $("grade-icon").style.color = grade.color;
  $("grade-text").textContent = grade.label;
  $("grade-sub").textContent = loss <= 5
    ? "هذه من أفضل النقلات التي يقترحها المحرك"
    : `الفارق عن أفضل نقلة: ${(loss / 100).toFixed(1)} بيدق`;
  $("grade-pill").textContent = grade.short;
  $("grade-pill").style.color = grade.color;
}

function showGradeForLastMove() {
  const last = state.moves.at(-1);
  if (!last) return showReadyGrade();
  const label = last.grade?.startsWith("حركة ") ? last.grade : `حركة ${last.grade || "عادية"}`;
  const color = GRADE_COLORS[label] || "#b8ce83";
  const short = label.replace(/^حركة\s+/, "");
  $("grade-icon").textContent = short.includes("فاشلة") ? "?" : short.includes("سيئة") ? "!" : "✓";
  $("grade-icon").style.color = color;
  $("grade-text").textContent = label;
  $("grade-sub").textContent = `تقييم آخر نقلة: ${((last.loss || 0) / 100).toFixed(1)} بيدق`;
  $("grade-pill").textContent = short;
  $("grade-pill").style.color = color;
}

function showReadyGrade() {
  $("grade-icon").textContent = "✦";
  $("grade-icon").style.color = "";
  $("grade-text").textContent = "سيظهر التقييم بعد نقلتك";
  $("grade-sub").textContent = "يُقيّم المحرك نقلات الطرفين";
  $("grade-pill").textContent = "جاهز";
  $("grade-pill").style.color = "";
}

function updateEngineLine(position, scores) {
  if (!analysisOptions.engine) return;
  const best = scores?.[0];
  if (!best) {
    $("engine-line").textContent = "تعذّر استخراج اقتراح لهذه الوضعية.";
    return;
  }
  const after = makeMove(position, best.move, true);
  const san = notation(position, best.move, after);
  const score = (best.score > 0 ? "+" : "") + (best.score / 100).toFixed(1);
  $("engine-line").textContent = `أفضل نقلة مقترحة: ${san} · التقييم ${score}`;
}

function chooseThemedMove(position, choices) {
  if (!choices.length) return null;
  if (opponentTheme === "balanced") return choices[Math.floor(Math.random() * choices.length)];
  const ranked = choices.map(choice => {
    const next = makeMove(position, choice.move, true);
    const givesCheck = inCheck(next, "w");
    let styleBonus = 0;
    if (opponentTheme === "aggressive") {
      if (givesCheck) styleBonus += 180;
      if (choice.move.capture) styleBonus += 35 + Math.round(VALUE[kind(choice.move.capture)] / 12);
    } else if (opponentTheme === "tactical") {
      if (givesCheck) styleBonus += 120;
      if (choice.move.capture) styleBonus += 105 + Math.round(VALUE[kind(choice.move.capture)] / 8);
      if (choice.move.promotion) styleBonus += 140;
    } else if (opponentTheme === "defensive") {
      const whiteCaptures = legalMoves(next).filter(reply => reply.capture && next.board[reply.to]);
      const greatestRisk = whiteCaptures.reduce((risk, reply) => Math.max(risk, VALUE[kind(next.board[reply.to])] || 0), 0);
      styleBonus -= Math.round(greatestRisk * 0.45);
    }
    return { ...choice, themedScore: choice.score + styleBonus };
  }).sort((a, b) => b.themedScore - a.themedScore);
  const top = ranked[0].themedScore;
  const close = ranked.filter(choice => top - choice.themedScore <= 12);
  return close[Math.floor(Math.random() * close.length)] || ranked[0];
}

function adaptDifficulty(loss) {
  if (opponentMode !== "adaptive") return;
  adaptiveLosses.push(loss);
  if (adaptiveLosses.length < 3) return;
  const average = adaptiveLosses.reduce((sum, item) => sum + item, 0) / adaptiveLosses.length;
  if (average > 250 && difficulty > 1) difficulty--;
  else if (average < 35 && difficulty < 7) difficulty++;
  adaptiveLosses = [];
  updateOpponentLabel();
  syncSetupUI();
}

function commit(move, scores) {
  if (clockHandle !== null) tickClock();
  if (clockEndStatus) return;
  const before = state;
  const actor = state.turn;
  const result = gradeFor(scores, move);
  const after = makeMove(before, move, true);
  const san = notation(before, move, after);
  after.moves.push({ san, actor, grade: result.grade.label, loss: result.loss });
  after.evalWhite = actor === "w" ? result.score : -result.score;
  undoStack.push(copyState(before));
  state = after;
  if (timeControlId !== "none") {
    clock[actor] += TIME_CONTROLS[timeControlId].increment * 1000;
    lastClockAt = Date.now();
  }
  if (actor === "w") adaptDifficulty(result.loss);
  updateEngineLine(before, scores);
  persistGame();
  selected = null;
  legalForSelection = [];
  hintMove = null;
  render();
  showGrade(result.grade, result.loss);

  renderClock();
  const status = getGameStatus();
  if (status.over) {
    busy = false;
    stopClock();
    render();
    showEnd(status);
  } else if (state.turn === "b") {
    busy = true;
    busyReason = "opponent";
    render();
    const epoch = gameEpoch;
    setTimeout(() => playOpponent(epoch), 70);
  } else {
    busy = false;
    render();
  }
}

async function submitPlayerMove(move) {
  if (busy || state.turn !== "w" || getGameStatus().over) return;
  busy = true;
  busyReason = "grading";
  const epoch = gameEpoch;
  const snapshot = copyState(state);
  render();
  const scores = await analyze(snapshot, difficulty, gradingProfile(difficulty), epoch);
  if (epoch !== gameEpoch || state.turn !== "w" || clockEndStatus) return;
  busy = false;
  commit(move, scores || scoreMoves(snapshot, 1, { maxNodes: 180, maxTimeMs: 25 }));
}

async function playOpponent(epoch) {
  if (epoch !== gameEpoch || state.turn !== "b" || getGameStatus().over) return;
  const snapshot = copyState(state);
  const profile = difficultyProfile(difficulty);
  const scores = await analyze(snapshot, difficulty, profile, epoch);
  if (epoch !== gameEpoch || state.turn !== "b" || clockEndStatus) return;
  const choices = scores?.length ? scores : scoreMoves(snapshot, 1, { maxNodes: 180, maxTimeMs: 25 });
  if (!choices.length) {
    busy = false;
    render();
    return;
  }
  const tolerance = [600, 320, 150, 65, 28, 10, 2][difficulty - 1];
  const best = choices[0].score;
  const shortlist = choices.filter(choice => best - choice.score <= tolerance);
  const chosen = chooseThemedMove(snapshot, shortlist) || choices[0];
  busy = false;
  commit(chosen.move, choices);
}

function onSquareClick(index) {
  if (busy || state.turn !== "w" || getGameStatus().over) return;
  const piece = state.board[index];
  if (selected !== null) {
    const options = legalForSelection.filter(move => move.to === index);
    if (options.length) {
      const promotions = options.filter(move => move.promotion);
      if (promotions.length) return openPromotion(promotions);
      void submitPlayerMove(options[0]);
      return;
    }
    if (index === selected) {
      selected = null;
      legalForSelection = [];
      render();
      return;
    }
    if (piece && colorOf(piece) === "w") return selectSquare(index);
    selected = null;
    legalForSelection = [];
    render();
    return;
  }
  if (piece && colorOf(piece) === "w") selectSquare(index);
}

function selectSquare(index) {
  selected = index;
  legalForSelection = legalMoves(state, index);
  render();
}

function openPromotion(moves) {
  pendingPromotion = moves;
  $("promotion-options").replaceChildren();
  for (const move of moves) {
    const button = document.createElement("button");
    button.className = "promo-btn";
    button.textContent = GLYPH[move.promotion];
    button.setAttribute("aria-label", ({ Q: "وزير", R: "قلعة", B: "فيل", N: "حصان" })[move.promotion]);
    button.onclick = () => {
      $("promotion-overlay").classList.remove("show");
      const chosen = pendingPromotion?.find(option => option.promotion === move.promotion);
      pendingPromotion = null;
      if (chosen) void submitPlayerMove(chosen);
    };
    $("promotion-options").append(button);
  }
  $("promotion-overlay").classList.add("show");
}

function onSquareKeydown(index, event) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onSquareClick(index);
    return;
  }
  const delta = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key];
  if (!delta) return;
  event.preventDefault();
  const row = Math.floor(index / 8), column = index % 8;
  const visualRow = flipped ? 7 - row : row;
  const visualColumn = flipped ? 7 - column : column;
  const nextRow = visualRow + delta[0], nextColumn = visualColumn + delta[1];
  if (nextRow < 0 || nextRow > 7 || nextColumn < 0 || nextColumn > 7) return;
  const nextIndex = (flipped ? 7 - nextRow : nextRow) * 8 + (flipped ? 7 - nextColumn : nextColumn);
  focusSquare = nextIndex;
  const board = $("board");
  board.querySelectorAll(".square").forEach(square => { square.tabIndex = -1; });
  const target = board.querySelector(`[data-index="${nextIndex}"]`);
  if (target) {
    target.tabIndex = 0;
    target.focus();
  }
}

function renderArrows() {
  const svg = $("board-arrows");
  svg.replaceChildren();
  const ns = "http://www.w3.org/2000/svg";
  const defs = document.createElementNS(ns, "defs");
  for (const [id, fill] of [["suggestion-arrow", "#f3c75e"], ["threat-arrow", "#ef786f"]]) {
    const marker = document.createElementNS(ns, "marker");
    marker.setAttribute("id", `board-arrowhead-${id}`);
    marker.setAttribute("markerWidth", "4");
    marker.setAttribute("markerHeight", "4");
    marker.setAttribute("refX", "3.2");
    marker.setAttribute("refY", "2");
    marker.setAttribute("orient", "auto");
    marker.setAttribute("markerUnits", "userSpaceOnUse");
    const tip = document.createElementNS(ns, "path");
    tip.setAttribute("d", "M 0 0 L 4 2 L 0 4 z");
    tip.setAttribute("fill", fill);
    marker.append(tip);
    defs.append(marker);
  }
  svg.append(defs);

  const center = index => {
    const row = flipped ? 7 - (index >> 3) : index >> 3;
    const column = flipped ? 7 - (index & 7) : index & 7;
    return { x: (column + 0.5) * 12.5, y: (row + 0.5) * 12.5 };
  };
  const addArrow = (move, type) => {
    const from = center(move.from), to = center(move.to);
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", String(from.x));
    line.setAttribute("y1", String(from.y));
    line.setAttribute("x2", String(to.x));
    line.setAttribute("y2", String(to.y));
    line.setAttribute("class", `board-arrow ${type}`);
    line.setAttribute("marker-end", `url(#board-arrowhead-${type})`);
    svg.append(line);
  };

  if (analysisOptions.suggestionArrows && hintMove) addArrow(hintMove, "suggestion-arrow");
  if (analysisOptions.threatArrows && state.turn === "w") {
    const blackPosition = copyState(state);
    blackPosition.turn = "b";
    const threats = legalMoves(blackPosition)
      .filter(move => move.capture && state.board[move.to] && colorOf(state.board[move.to]) === "w")
      .sort((a, b) => (VALUE[kind(state.board[b.to])] || 0) - (VALUE[kind(state.board[a.to])] || 0))
      .slice(0, 5);
    threats.forEach(move => addArrow(move, "threat-arrow"));
  }
}

function renderBoard() {
  const element = $("board");
  const restoreFocus = element.contains(document.activeElement);
  element.replaceChildren();
  const checkedSquare = inCheck(state) ? state.board.indexOf(state.turn === "w" ? "K" : "k") : -1;
  for (let displayRow = 0; displayRow < 8; displayRow++) {
    for (let displayColumn = 0; displayColumn < 8; displayColumn++) {
      const row = flipped ? 7 - displayRow : displayRow;
      const column = flipped ? 7 - displayColumn : displayColumn;
      const index = row * 8 + column;
      const square = document.createElement("div");
      square.className = `square ${(row + column) % 2 === 0 ? "light" : "dark"}`;
      square.dataset.index = String(index);
      square.setAttribute("role", "gridcell");
      const piece = state.board[index];
      const pieceName = piece ? ({ p: "بيدق", r: "قلعة", n: "حصان", b: "فيل", q: "وزير", k: "ملك" })[kind(piece)] : "";
      square.setAttribute("aria-label", `${sqName(index)}${piece ? ` ${colorOf(piece) === "w" ? "أبيض" : "أسود"} ${pieceName}` : ""}`);
      square.tabIndex = index === focusSquare ? 0 : -1;
      square.onfocus = () => { focusSquare = index; };
      square.onkeydown = event => onSquareKeydown(index, event);
      if (state.lastMove && (index === state.lastMove.from || index === state.lastMove.to)) square.classList.add("last");
      if (index === selected) square.classList.add("selected");
      if (index === checkedSquare) square.classList.add("check");
      if (analysisOptions.suggestionArrows && hintMove && index === hintMove.from) square.classList.add("hint-from");
      if (analysisOptions.suggestionArrows && hintMove && index === hintMove.to) square.classList.add("hint-to");
      const possible = legalForSelection.find(move => move.to === index);
      if (possible) {
        if (piece || possible.epCapture !== undefined) square.classList.add("capture-hint");
        else {
          const dot = document.createElement("i");
          dot.className = "dot";
          square.append(dot);
        }
      }
      if (piece) {
        const symbol = document.createElement("span");
        symbol.className = `piece ${colorOf(piece) === "w" ? "white" : "black"}`;
        symbol.textContent = GLYPH[piece];
        square.append(symbol);
      }
      if (displayColumn === 0) {
        const rank = document.createElement("span");
        rank.className = "coord rank";
        rank.textContent = String(8 - row);
        square.append(rank);
      }
      if (displayRow === 7) {
        const file = document.createElement("span");
        file.className = "coord file";
        file.textContent = String.fromCharCode(97 + column);
        square.append(file);
      }
      square.onclick = () => {
        focusSquare = index;
        square.focus({ preventScroll: true });
        onSquareClick(index);
      };
      element.append(square);
    }
  }
  renderArrows();
  if (restoreFocus) element.querySelector(`[data-index="${focusSquare}"]`)?.focus({ preventScroll: true });
}

function renderMoves() {
  const element = $("moves");
  if (!state.moves.length) {
    element.innerHTML = '<div class="empty-moves">ابدأ المباراة بأول نقلة لك ♙</div>';
  } else {
    element.replaceChildren();
    for (let index = 0; index < state.moves.length; index += 2) {
      const row = document.createElement("div");
      row.className = "move-row";
      const number = document.createElement("span");
      number.className = "move-num";
      number.textContent = `${Math.floor(index / 2) + 1}.`;
      row.append(number);
      for (let moveIndex = index; moveIndex < Math.min(index + 2, state.moves.length); moveIndex++) {
        const move = state.moves[moveIndex];
        const cell = document.createElement("div");
        cell.className = `move-cell${moveIndex === state.moves.length - 1 ? " latest" : ""}`;
        const san = document.createElement("span");
        san.className = "move-san";
        san.textContent = move.san;
        if (analysisOptions.moveEvaluation) {
          const grade = document.createElement("span");
          grade.className = "mini-grade";
          grade.textContent = (move.grade || "").replace(/^حركة\s+/, "");
          grade.title = move.grade || "";
          grade.style.color = GRADE_COLORS[move.grade] || "";
          cell.append(san, grade);
        } else {
          cell.append(san);
        }
        row.append(cell);
      }
      element.append(row);
    }
    element.scrollTop = element.scrollHeight;
  }
  $("move-count").textContent = `${state.moves.length} ${state.moves.length === 1 ? "نقلة" : "نقلات"}`;
}

function renderEvaluation() {
  const white = Math.max(5, Math.min(95, 50 + state.evalWhite / 24));
  $("eval-fill").style.height = `${white}%`;
  const value = (state.evalWhite > 0 ? "+" : "") + (state.evalWhite / 100).toFixed(1);
  $("eval-value").textContent = value;
  $("mobile-eval-value").textContent = value;
  $("mobile-eval-fill").style.width = `${white}%`;
  const description = Math.abs(state.evalWhite) < 35 ? "الموقف متعادل"
    : state.evalWhite > 0 ? (state.evalWhite > 250 ? "أفضلية كبيرة للأبيض" : "أفضلية للأبيض")
      : (state.evalWhite < -250 ? "أفضلية كبيرة للأسود" : "أفضلية للأسود");
  $("eval-desc").textContent = description;
}

function renderStatus() {
  const status = getGameStatus();
  $("turn-counter").textContent = `النقلة ${state.full}`;
  $("pulse").style.background = status.check ? "#e97d72" : busy ? "#edc26a" : status.over ? "#81949b" : "#83c99e";
  if (status.over) $("game-status").textContent = status.title;
  else if (busy && busyReason === "grading") $("game-status").textContent = "نحلّل نقلتك بأمان في الخلفية…";
  else if (busy) $("game-status").textContent = "الخصم يحلّل نقلته…";
  else if (status.check) $("game-status").textContent = state.turn === "w" ? "كش! حرّك الملك أو أوقف الهجوم" : "الخصم في كش";
  else $("game-status").textContent = state.turn === "w" ? "دورك — حرّك قطعة بيضاء" : "دور الخصم";
}

function render() {
  renderBoard();
  renderMoves();
  renderEvaluation();
  applyAnalysisOptions();
  renderClock();
  renderStatus();
  $("captured-black").textContent = state.captured.w.map(piece => GLYPH[piece]).join("");
  $("captured-white").textContent = state.captured.b.map(piece => GLYPH[piece]).join("");
  $("undo").disabled = undoStack.length === 0 || busy;
  $("hint").disabled = state.turn !== "w" || busy || getGameStatus().over;
}

function showEnd(status) {
  $("end-icon").textContent = status.icon;
  $("end-title").textContent = status.title;
  $("end-sub").textContent = status.detail;
  $("end-overlay").classList.add("show");
}

function syncDifficulty(value) {
  difficulty = Math.max(1, Math.min(7, Number(value) || 3));
  $("difficulty").value = String(difficulty);
  updateOpponentLabel();
  syncSetupUI();
  persistGame();
}

function showGame() {
  syncDifficulty(difficulty);
  $("start-screen").hidden = true;
  $("setup-screen").hidden = true;
  $("game-app").hidden = false;
  render();
  const status = getGameStatus();
  if (status.over) showEnd(status);
  else {
    startClock();
    if (state.turn === "b" && !busy) {
      busy = true;
      busyReason = "opponent";
      render();
      setTimeout(() => playOpponent(gameEpoch), 70);
    }
  }
}

function newGame() {
  gameEpoch++;
  stopClock();
  resetAnalysisWorker();
  if (hintTimer) clearTimeout(hintTimer);
  $("end-overlay").classList.remove("show");
  $("promotion-overlay").classList.remove("show");
  state = freshState();
  clockEndStatus = null;
  adaptiveLosses = [];
  const startingTime = TIME_CONTROLS[timeControlId].minutes * 60 * 1000;
  clock = { w: startingTime, b: startingTime };
  undoStack = [];
  selected = null;
  legalForSelection = [];
  hintMove = null;
  busy = false;
  flipped = false;
  pendingPromotion = null;
  focusSquare = 52;
  showReadyGrade();
  syncDifficulty(difficulty);
  persistGame();
  showGame();
}

function undo() {
  if (!undoStack.length || busy || clockEndStatus) return;
  pauseClock();
  let steps = state.turn === "w" && state.moves.length >= 2 ? 2 : 1;
  while (steps-- > 0 && undoStack.length) state = undoStack.pop();
  selected = null;
  legalForSelection = [];
  hintMove = null;
  $("end-overlay").classList.remove("show");
  showGradeForLastMove();
  persistGame();
  render();
  startClock();
}

function suggest() {
  if (state.turn !== "w" || busy || getGameStatus().over) return;
  const snapshot = copyState(state);
  const epoch = gameEpoch;
  busy = true;
  busyReason = "grading";
  render();
  void analyze(snapshot, difficulty, gradingProfile(difficulty), epoch).then(scores => {
    if (epoch !== gameEpoch || state.turn !== "w" || clockEndStatus) return;
    busy = false;
    if (!scores?.length) return render();
    hintMove = scores[0].move;
    updateEngineLine(snapshot, scores);
    if (hintTimer) clearTimeout(hintTimer);
    render();
    hintTimer = setTimeout(() => { hintMove = null; render(); }, 2600);
    $("grade-text").textContent = `الاقتراح: ${sqName(hintMove.from)} إلى ${sqName(hintMove.to)}`;
    $("grade-sub").textContent = "المربعان المحددان يوضحان النقلة المقترحة";
    $("grade-icon").textContent = "✦";
    $("grade-pill").textContent = "تلميح";
  });
}

function init() {
  const restored = restoreGame();
  if (!restored) state = freshState();
  $("difficulty").value = String(difficulty);
  updateOpponentLabel();
  syncSetupUI();
  $("new-game").onclick = newGame;
  $("end-new").onclick = newGame;
  $("open-setup").onclick = () => {
    $("start-screen").hidden = true;
    $("setup-screen").hidden = false;
    syncSetupUI();
  };
  $("setup-back").onclick = () => {
    $("setup-screen").hidden = true;
    $("start-screen").hidden = false;
  };
  $("start-match").onclick = newGame;
  $("continue-game").hidden = !restored || state.moves.length === 0;
  $("continue-game").onclick = showGame;
  $("back-to-menu").onclick = () => {
    busy = false;
    pauseClock();
    gameEpoch++;
    resetAnalysisWorker();
    $("game-app").hidden = true;
    $("setup-screen").hidden = true;
    $("start-screen").hidden = false;
    $("end-overlay").classList.remove("show");
  };
  $("undo").onclick = undo;
  $("hint").onclick = suggest;
  $("flip").onclick = () => { flipped = !flipped; renderBoard(); };
  $("difficulty").onchange = event => {
    opponentMode = "manual";
    syncDifficulty(event.target.value);
  };
  $("setup-difficulty").onchange = event => {
    opponentMode = "manual";
    syncDifficulty(event.target.value);
  };
  document.querySelectorAll("[data-group]").forEach(button => {
    button.onclick = () => {
      const group = button.dataset.group;
      opponentMode = group === "adaptive" ? "adaptive" : "manual";
      difficulty = GROUP_LEVELS[group] || 3;
      adaptiveLosses = [];
      syncDifficulty(difficulty);
    };
  });
  document.querySelectorAll("[data-theme]").forEach(button => {
    button.onclick = () => {
      opponentTheme = button.dataset.theme;
      updateOpponentLabel();
      syncSetupUI();
      persistGame();
    };
  });
  document.querySelectorAll("[data-time]").forEach(button => {
    button.onclick = () => {
      timeControlId = button.dataset.time;
      syncSetupUI();
      persistGame();
    };
  });
  for (const [id, key] of [["option-eval-bar", "evaluationBar"], ["option-threats", "threatArrows"], ["option-suggestions", "suggestionArrows"], ["option-move-eval", "moveEvaluation"], ["option-engine", "engine"]]) {
    $(id).onchange = event => {
      analysisOptions[key] = event.target.checked;
      applyAnalysisOptions();
      render();
      persistGame();
    };
  }
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      $("promotion-overlay").classList.remove("show");
      pendingPromotion = null;
    }
  });
  if (state.moves.length) showGradeForLastMove(); else showReadyGrade();
  render();
  initPwa();
  if (!restored) persistGame();
}

init();
