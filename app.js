/*
  Fil: app.js
  Formål: Interaktiv logikk for GURPS Dice Assistant med ferdigheter, modifikatorer, 3d6-kast, criticals, logg, skade og CSS-styrte terninger.
  Versjon: 0.3.0
*/

(() => {
  "use strict";

  const STORAGE_KEYS = {
    skills: "gurps-dice-assistant.skills.v0.3.0",
    log: "gurps-dice-assistant.roll-log.v0.3.0"
  };

  const DEFAULT_SKILLS = [
    { name: "Bow", level: 12 },
    { name: "Broadsword", level: 12 },
    { name: "Guns", level: 12 },
    { name: "Knife", level: 12 },
    { name: "Stealth", level: 12 },
    { name: "Observation", level: 12 },
    { name: "Fast-Talk", level: 12 },
    { name: "Dodge", level: 9 }
  ];

  const DEFAULT_WEAPONS = [
    {
      name: "Egendefinert våpen",
      skill: "",
      damageFormula: "",
      damageType: "cr",
      accuracy: 0
    },
    {
      name: "Bow – eksempel",
      skill: "Bow",
      damageFormula: "1d imp",
      damageType: "imp",
      accuracy: 2
    },
    {
      name: "Knife – eksempel",
      skill: "Knife",
      damageFormula: "1d-2 imp",
      damageType: "imp",
      accuracy: 0
    },
    {
      name: "Pistol – eksempel",
      skill: "Guns",
      damageFormula: "2d+2 pi",
      damageType: "pi",
      accuracy: 2
    }
  ];

  const RANGE_SPEED_THRESHOLDS = [
    2, 3, 5, 7, 10, 15, 20, 30, 50, 70,
    100, 150, 200, 300, 500, 700, 1000,
    1500, 2000, 3000, 5000, 7000, 10000,
    15000, 20000, 30000, 50000, 70000, 100000
  ];

  const DIE_SYMBOLS = {
    1: "⚀",
    2: "⚁",
    3: "⚂",
    4: "⚃",
    5: "⚄",
    6: "⚅"
  };

  const state = {
    skills: [],
    weapons: DEFAULT_WEAPONS,
    rollLog: []
  };

  const dom = {
    characterNameInput: document.getElementById("characterNameInput"),
    skillSelect: document.getElementById("skillSelect"),
    skillLevelInput: document.getElementById("skillLevelInput"),
    rollTypeSelect: document.getElementById("rollTypeSelect"),

    newSkillNameInput: document.getElementById("newSkillNameInput"),
    newSkillLevelInput: document.getElementById("newSkillLevelInput"),
    addSkillButton: document.getElementById("addSkillButton"),

    modifierList: document.getElementById("modifierList"),
    modifierTotalLabel: document.getElementById("modifierTotalLabel"),

    accuracyInput: document.getElementById("accuracyInput"),
    snapShotInput: document.getElementById("snapShotInput"),
    distanceInput: document.getElementById("distanceInput"),
    speedInput: document.getElementById("speedInput"),
    rangeSpeedModifierInput: document.getElementById("rangeSpeedModifierInput"),
    customModifierInput: document.getElementById("customModifierInput"),

    effectiveTargetNumber: document.getElementById("effectiveTargetNumber"),
    rollButton: document.getElementById("rollButton"),
    manualRollButton: document.getElementById("manualRollButton"),
    manualRollControls: document.getElementById("manualRollControls"),
    manualRollInput: document.getElementById("manualRollInput"),
    applyManualRollButton: document.getElementById("applyManualRollButton"),
    rollResultCard: document.getElementById("rollResultCard"),

    weaponSelect: document.getElementById("weaponSelect"),
    damageFormulaInput: document.getElementById("damageFormulaInput"),
    armorDivisorInput: document.getElementById("armorDivisorInput"),
    damageTypeSelect: document.getElementById("damageTypeSelect"),
    damageRollButton: document.getElementById("damageRollButton"),
    damageResultCard: document.getElementById("damageResultCard"),

    rollLogList: document.getElementById("rollLogList"),
    clearLogButton: document.getElementById("clearLogButton"),
    resetSessionButton: document.getElementById("resetSessionButton")
  };

  function init() {
    state.skills = loadFromStorage(STORAGE_KEYS.skills, DEFAULT_SKILLS);
    state.rollLog = loadFromStorage(STORAGE_KEYS.log, []);

    normalizeSkills();
    populateSkillSelect();
    populateWeaponSelect();
    renderLog();
    bindEvents();

    if (state.skills.length > 0) {
      dom.skillSelect.value = state.skills[0].name;
      syncSelectedSkillLevel();
    }

    updateRangeSpeedModifier();
    updateEffectiveTarget();
  }

  function bindEvents() {
    dom.skillSelect.addEventListener("change", () => {
      syncSelectedSkillLevel();
      updateEffectiveTarget();
    });

    dom.skillLevelInput.addEventListener("input", () => {
      updateSelectedSkillLevel();
      updateEffectiveTarget();
    });

    dom.rollTypeSelect.addEventListener("change", updateEffectiveTarget);
    dom.addSkillButton.addEventListener("click", addSkillFromForm);
    dom.modifierList.addEventListener("change", updateEffectiveTarget);

    [
      dom.accuracyInput,
      dom.snapShotInput,
      dom.rangeSpeedModifierInput,
      dom.customModifierInput
    ].forEach((input) => {
      input.addEventListener("input", updateEffectiveTarget);
    });

    [dom.distanceInput, dom.speedInput].forEach((input) => {
      input.addEventListener("input", () => {
        updateRangeSpeedModifier();
        updateEffectiveTarget();
      });
    });

    dom.rollButton.addEventListener("click", async () => {
      dom.rollButton.disabled = true;

      try {
        const dice = await animateDiceRoll({
          count: 3,
          container: dom.rollResultCard,
          title: "Kaster 3d6 ...",
          description: "Terningene ruller før resultatet avgjøres."
        });

        await resolveSkillRoll(dice);
      } finally {
        dom.rollButton.disabled = false;
      }
    });

    dom.manualRollButton.addEventListener("click", () => {
      dom.manualRollControls.hidden = !dom.manualRollControls.hidden;

      if (!dom.manualRollControls.hidden) {
        dom.manualRollInput.focus();
      }
    });

    dom.applyManualRollButton.addEventListener("click", async () => {
      const manualTotal = readNumber(dom.manualRollInput, NaN);

      if (!Number.isInteger(manualTotal) || manualTotal < 3 || manualTotal > 18) {
        renderInlineMessage(
          dom.rollResultCard,
          "Ugyldig manuelt kast",
          "Skriv inn et heltall fra 3 til 18.",
          "failure"
        );
        return;
      }

      await resolveSkillRoll([manualTotal], { isManual: true });
    });

    dom.weaponSelect.addEventListener("change", syncSelectedWeapon);

    dom.damageRollButton.addEventListener("click", async () => {
      dom.damageRollButton.disabled = true;

      try {
        const damageDefinition = getCurrentDamageDefinition();

        if (!damageDefinition.ok) {
          renderInlineMessage(
            dom.damageResultCard,
            "Kan ikke kaste skade",
            damageDefinition.message,
            "failure"
          );
          return;
        }

        const dice = await animateDiceRoll({
          count: damageDefinition.parsed.diceCount,
          container: dom.damageResultCard,
          title: "Kaster skade ...",
          description: `Formel: ${damageDefinition.formula}`
        });

        const damageResult = rollDamageFromDefinition(damageDefinition, dice);

        renderDamageResult(damageResult);

        addLogEntry({
          type: "damage",
          title: `Skade: ${damageResult.total} ${damageResult.damageType}`,
          details: `${damageResult.formula} → [${damageResult.dice.join(", ")}] ${formatSignedNumber(damageResult.flatModifier)}`
        });
      } finally {
        dom.damageRollButton.disabled = false;
      }
    });

    dom.clearLogButton.addEventListener("click", () => {
      state.rollLog = [];
      saveToStorage(STORAGE_KEYS.log, state.rollLog);
      renderLog();
    });

    dom.resetSessionButton.addEventListener("click", resetSession);
  }

  function loadFromStorage(key, fallbackValue) {
    try {
      const storedValue = localStorage.getItem(key);
      return storedValue ? JSON.parse(storedValue) : structuredClone(fallbackValue);
    } catch (error) {
      console.warn(`Kunne ikke lese fra localStorage: ${key}`, error);
      return structuredClone(fallbackValue);
    }
  }

  function saveToStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn(`Kunne ikke lagre i localStorage: ${key}`, error);
    }
  }

  function normalizeSkills() {
    const skillMap = new Map();

    [...DEFAULT_SKILLS, ...state.skills].forEach((skill) => {
      const name = String(skill.name || "").trim();
      const level = clampInteger(skill.level, 3, 30, 12);

      if (name) {
        skillMap.set(name.toLowerCase(), { name, level });
      }
    });

    state.skills = [...skillMap.values()].sort((a, b) => a.name.localeCompare(b.name, "no"));
    saveToStorage(STORAGE_KEYS.skills, state.skills);
  }

  function populateSkillSelect() {
    const currentValue = dom.skillSelect.value;

    dom.skillSelect.innerHTML = "";

    state.skills.forEach((skill) => {
      const option = document.createElement("option");
      option.value = skill.name;
      option.textContent = skill.name;
      dom.skillSelect.appendChild(option);
    });

    if (currentValue && state.skills.some((skill) => skill.name === currentValue)) {
      dom.skillSelect.value = currentValue;
    }
  }

  function populateWeaponSelect() {
    dom.weaponSelect.innerHTML = "";

    state.weapons.forEach((weapon, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = weapon.name;
      dom.weaponSelect.appendChild(option);
    });

    syncSelectedWeapon();
  }

  function addSkillFromForm() {
    const name = dom.newSkillNameInput.value.trim();
    const level = clampInteger(readNumber(dom.newSkillLevelInput, 12), 3, 30, 12);

    if (!name) {
      dom.newSkillNameInput.focus();
      return;
    }

    const existingSkill = state.skills.find((skill) => skill.name.toLowerCase() === name.toLowerCase());

    if (existingSkill) {
      existingSkill.level = level;
    } else {
      state.skills.push({ name, level });
    }

    normalizeSkills();
    populateSkillSelect();

    dom.skillSelect.value = name;
    dom.skillLevelInput.value = String(level);

    dom.newSkillNameInput.value = "";
    dom.newSkillLevelInput.value = "12";

    updateEffectiveTarget();
  }

  function syncSelectedSkillLevel() {
    const selectedSkill = getSelectedSkill();

    if (selectedSkill) {
      dom.skillLevelInput.value = String(selectedSkill.level);
    }
  }

  function updateSelectedSkillLevel() {
    const selectedSkill = getSelectedSkill();

    if (!selectedSkill) {
      return;
    }

    selectedSkill.level = clampInteger(readNumber(dom.skillLevelInput, 12), 3, 30, 12);
    saveToStorage(STORAGE_KEYS.skills, state.skills);
  }

  function getSelectedSkill() {
    return state.skills.find((skill) => skill.name === dom.skillSelect.value) || null;
  }

  function syncSelectedWeapon() {
    const weapon = state.weapons[Number(dom.weaponSelect.value)];

    if (!weapon) {
      return;
    }

    dom.damageFormulaInput.value = weapon.damageFormula;
    dom.damageTypeSelect.value = weapon.damageType;
    dom.accuracyInput.value = String(weapon.accuracy ?? 0);

    if (weapon.skill && state.skills.some((skill) => skill.name === weapon.skill)) {
      dom.skillSelect.value = weapon.skill;
      syncSelectedSkillLevel();
    }

    updateEffectiveTarget();
  }

  function getCheckedModifiers() {
    const checkedInputs = [...dom.modifierList.querySelectorAll("input[type='checkbox']:checked")];

    return checkedInputs.map((input) => ({
      name: input.dataset.modifierName || "Modifikator",
      value: readNumberFromValue(input.dataset.modifierValue, 0)
    }));
  }

  function getModifierBreakdown() {
    const toggledModifiers = getCheckedModifiers();
    const accuracy = readNumber(dom.accuracyInput, 0);
    const snapShot = readNumber(dom.snapShotInput, 0);
    const rangeSpeed = readNumber(dom.rangeSpeedModifierInput, 0);
    const custom = readNumber(dom.customModifierInput, 0);

    const manualModifiers = [
      { name: "Accuracy / Acc", value: accuracy },
      { name: "SS / Bulk", value: snapShot },
      { name: "Range/speed", value: rangeSpeed },
      { name: "Egendefinert", value: custom }
    ].filter((modifier) => modifier.value !== 0);

    return [...toggledModifiers, ...manualModifiers];
  }

  function updateRangeSpeedModifier() {
    const distance = Math.max(0, readNumber(dom.distanceInput, 0));
    const speed = Math.max(0, readNumber(dom.speedInput, 0));
    const rangeSpeedValue = distance + speed;

    if (rangeSpeedValue <= 0) {
      dom.rangeSpeedModifierInput.value = "0";
      return;
    }

    dom.rangeSpeedModifierInput.value = String(calculateRangeSpeedModifier(rangeSpeedValue));
  }

  function calculateRangeSpeedModifier(rangeSpeedValue) {
    const thresholdIndex = RANGE_SPEED_THRESHOLDS.findIndex((threshold) => rangeSpeedValue <= threshold);

    if (thresholdIndex >= 0) {
      return -thresholdIndex;
    }

    const largestKnownThreshold = RANGE_SPEED_THRESHOLDS[RANGE_SPEED_THRESHOLDS.length - 1];
    const extraSteps = Math.ceil(Math.log10(rangeSpeedValue / largestKnownThreshold) * 6);

    return -(RANGE_SPEED_THRESHOLDS.length - 1 + Math.max(0, extraSteps));
  }

  function updateEffectiveTarget() {
    const baseSkillLevel = clampInteger(readNumber(dom.skillLevelInput, 12), 3, 30, 12);
    const modifierTotal = getModifierBreakdown().reduce((sum, modifier) => sum + modifier.value, 0);
    const effectiveTarget = baseSkillLevel + modifierTotal;

    dom.modifierTotalLabel.textContent = `Total: ${formatSignedNumber(modifierTotal)}`;
    dom.effectiveTargetNumber.textContent = String(effectiveTarget);
  }

  async function resolveSkillRoll(dice, options = {}) {
    const total = sum(dice);
    const selectedSkill = getSelectedSkill();
    const skillName = selectedSkill?.name || "Ukjent skill";
    const baseSkillLevel = clampInteger(readNumber(dom.skillLevelInput, 12), 3, 30, 12);
    const modifiers = getModifierBreakdown();
    const modifierTotal = modifiers.reduce((acc, modifier) => acc + modifier.value, 0);
    const effectiveTarget = baseSkillLevel + modifierTotal;
    const result = evaluateGurpsRoll(total, effectiveTarget);

    const rollData = {
      skillName,
      rollType: dom.rollTypeSelect.value,
      baseSkillLevel,
      effectiveTarget,
      modifiers,
      modifierTotal,
      dice,
      total,
      result,
      isManual: Boolean(options.isManual)
    };

    renderRollResult(rollData);

    addLogEntry({
      type: result.success ? "success" : "failure",
      title: `${skillName}: ${total} mot ${effectiveTarget}`,
      details: buildRollSummary(rollData)
    });

    if (rollData.rollType === "attack" && result.success) {
      const damageDefinition = getCurrentDamageDefinition();

      if (!damageDefinition.ok) {
        renderInlineMessage(
          dom.damageResultCard,
          "Treff registrert",
          "Velg våpen eller skriv inn skadeformel for å kaste skade.",
          "success"
        );
        return;
      }

      const damageDice = await animateDiceRoll({
        count: damageDefinition.parsed.diceCount,
        container: dom.damageResultCard,
        title: "Treff! Kaster skade ...",
        description: `Formel: ${damageDefinition.formula}`
      });

      const damageResult = rollDamageFromDefinition(damageDefinition, damageDice);

      renderDamageResult(damageResult, { automatic: true });

      addLogEntry({
        type: "damage",
        title: `Automatisk skade: ${damageResult.total} ${damageResult.damageType}`,
        details: `${damageResult.formula} → [${damageResult.dice.join(", ")}] ${formatSignedNumber(damageResult.flatModifier)}`
      });
    }
  }

  function evaluateGurpsRoll(total, effectiveTarget) {
    const isCriticalSuccess =
      total <= 4 ||
      (total === 5 && effectiveTarget >= 15) ||
      (total === 6 && effectiveTarget >= 16);

    const isCriticalFailure =
      total === 18 ||
      (total === 17 && effectiveTarget <= 15) ||
      total >= effectiveTarget + 10;

    const isAutomaticFailure = total >= 17;
    const success = isCriticalSuccess || (!isAutomaticFailure && !isCriticalFailure && total <= effectiveTarget);
    const margin = success ? effectiveTarget - total : total - effectiveTarget;

    if (isCriticalSuccess) {
      return {
        success: true,
        critical: true,
        label: "Critical success",
        tone: "success",
        margin,
        comment: "Ekstremt godt kast. Bruk relevant critical success-effekt for situasjonen."
      };
    }

    if (isCriticalFailure) {
      return {
        success: false,
        critical: true,
        label: "Critical failure",
        tone: "failure",
        margin,
        comment: "Katastrofalt kast. Bruk relevant critical failure-effekt for situasjonen."
      };
    }

    if (success) {
      return {
        success: true,
        critical: false,
        label: "Success",
        tone: "success",
        margin,
        comment: `Lyktes med margin ${margin}.`
      };
    }

    return {
      success: false,
      critical: false,
      label: "Failure",
      tone: "failure",
      margin,
      comment: `Mislyktes med margin ${margin}.`
    };
  }

  function renderRollResult(rollData) {
    const modifierRows = rollData.modifiers.length
      ? rollData.modifiers
          .map(
            (modifier) => `
              <li>
                <span>${escapeHtml(modifier.name)}</span>
                <strong>${formatSignedNumber(modifier.value)}</strong>
              </li>
            `
          )
          .join("")
      : `
          <li>
            <span>Ingen aktive modifikatorer</span>
            <strong>0</strong>
          </li>
        `;

    const diceText = rollData.isManual
      ? `Manuelt resultat: ${rollData.total}`
      : `Terninger: ${rollData.dice.join(" + ")} = ${rollData.total}`;

    const diceHtml = rollData.isManual
      ? ""
      : buildDiceRowHtml(rollData.dice, rollData.result.tone, {
          label: "Kastede terninger"
        });

    dom.rollResultCard.innerHTML = `
      ${diceHtml}

      <h3 class="result-title ${rollData.result.tone}">
        ${escapeHtml(rollData.result.label)}
      </h3>

      <ul class="result-meta">
        <li>
          <span>Skill</span>
          <strong>${escapeHtml(rollData.skillName)}</strong>
        </li>
        <li>
          <span>Basisnivå</span>
          <strong>${rollData.baseSkillLevel}</strong>
        </li>
        <li>
          <span>Effektiv target</span>
          <strong>${rollData.effectiveTarget}</strong>
        </li>
        <li>
          <span>Kast</span>
          <strong>${escapeHtml(diceText)}</strong>
        </li>
        <li>
          <span>Margin</span>
          <strong>${rollData.result.margin}</strong>
        </li>
        ${modifierRows}
      </ul>

      <p class="result-comment">
        ${escapeHtml(rollData.result.comment)}
      </p>
    `;
  }

  function buildRollSummary(rollData) {
    const modifierText = rollData.modifiers.length
      ? rollData.modifiers
          .map((modifier) => `${modifier.name} ${formatSignedNumber(modifier.value)}`)
          .join(", ")
      : "ingen modifikatorer";

    const rollSource = rollData.isManual ? "manuelt" : rollData.dice.join(" + ");

    return `${rollData.result.label}. Kast: ${rollSource}. Basis ${rollData.baseSkillLevel}, modifikatorer: ${modifierText}.`;
  }

  function getCurrentDamageDefinition() {
    const formula = dom.damageFormulaInput.value.trim();
    const damageTypeFromSelect = dom.damageTypeSelect.value;
    const parsed = parseDamageFormula(formula);

    if (!parsed.ok) {
      return {
        ok: false,
        message: parsed.message
      };
    }

    return {
      ok: true,
      formula,
      parsed,
      damageTypeFromSelect,
      armorDivisor: Math.max(1, readNumber(dom.armorDivisorInput, 1))
    };
  }

  function rollDamageFromDefinition(damageDefinition, providedDice = null) {
    const dice = providedDice || rollDice(damageDefinition.parsed.diceCount);
    const rolledTotal = sum(dice);
    const total = rolledTotal + damageDefinition.parsed.flatModifier;
    const damageType = damageDefinition.parsed.damageType || damageDefinition.damageTypeFromSelect;

    return {
      ok: true,
      formula: damageDefinition.formula,
      dice,
      rolledTotal,
      flatModifier: damageDefinition.parsed.flatModifier,
      total,
      damageType,
      armorDivisor: damageDefinition.armorDivisor
    };
  }

  function parseDamageFormula(formula) {
    const pattern = /^\s*(\d*)d(?:6)?\s*([+-]\s*\d+)?\s*([a-z+\-]*)?\s*$/i;
    const match = formula.match(pattern);

    if (!match) {
      return {
        ok: false,
        message: "Bruk format som 1d, 2d+1, 1d-2 imp eller 3d+3 pi."
      };
    }

    const diceCount = match[1] ? Number(match[1]) : 1;
    const flatModifier = match[2] ? Number(match[2].replace(/\s+/g, "")) : 0;
    const damageType = match[3] || "";

    if (!Number.isInteger(diceCount) || diceCount < 1 || diceCount > 20) {
      return {
        ok: false,
        message: "Antall terninger må være mellom 1 og 20."
      };
    }

    return {
      ok: true,
      diceCount,
      flatModifier,
      damageType
    };
  }

  function renderDamageResult(damageResult, options = {}) {
    const title = options.automatic ? "Automatisk skade etter treff" : "Skaderesultat";

    dom.damageResultCard.innerHTML = `
      ${buildDiceRowHtml(damageResult.dice, "success", { label: "Skadeterninger" })}

      <h3 class="result-title success">${title}</h3>

      <ul class="result-meta">
        <li>
          <span>Formel</span>
          <strong>${escapeHtml(damageResult.formula)}</strong>
        </li>
        <li>
          <span>Terninger</span>
          <strong>${damageResult.dice.join(" + ")} = ${damageResult.rolledTotal}</strong>
        </li>
        <li>
          <span>Flat mod</span>
          <strong>${formatSignedNumber(damageResult.flatModifier)}</strong>
        </li>
        <li>
          <span>Total skade</span>
          <strong>${damageResult.total}</strong>
        </li>
        <li>
          <span>Type</span>
          <strong>${escapeHtml(damageResult.damageType)}</strong>
        </li>
        <li>
          <span>Armor divisor</span>
          <strong>${damageResult.armorDivisor}</strong>
        </li>
      </ul>

      <p class="result-comment">
        Husk å bruke DR, armor divisor, injury multiplier og hit location etter behov.
      </p>
    `;
  }

  async function animateDiceRoll({ count, container, title, description }) {
    const safeCount = Math.max(1, Math.min(20, count));
    const frames = Math.max(8, Math.min(16, 6 + safeCount));
    const frameDelay = 70;

    for (let frame = 0; frame < frames; frame += 1) {
      const frameDice = Array.from({ length: safeCount }, () => randomDieValue());

      renderRollingDiceFrame(container, frameDice, {
        title,
        description,
        frame,
        frames
      });

      await wait(frameDelay + frame * 8);
    }

    const finalDice = rollDice(safeCount);

    renderRollingDiceFrame(container, finalDice, {
      title: "Resultat klart",
      description: "Terningene har landet.",
      frame: frames,
      frames
    });

    await wait(120);

    return finalDice;
  }

  function renderRollingDiceFrame(container, dice, options = {}) {
    const progressPercent = options.frames > 0
      ? Math.round((Math.min(options.frame + 1, options.frames) / options.frames) * 100)
      : 100;

    container.innerHTML = `
      <div class="dice-stage">
        <div class="dice-stage-header">
          <h3 class="result-title warning">${escapeHtml(options.title || "Kaster terninger ...")}</h3>
          <span class="dice-progress-label">${progressPercent}%</span>
        </div>

        ${buildDiceRowHtml(dice, "warning", {
          animated: true,
          label: "Rullende terninger"
        })}

        <div class="dice-progress-track">
          <div class="dice-progress-bar" style="--dice-progress: ${progressPercent}%;"></div>
        </div>

        <p class="result-comment">
          ${escapeHtml(options.description || "Terningene ruller ...")}
        </p>
      </div>
    `;
  }

  function buildDiceRowHtml(dice, tone = "neutral", options = {}) {
    const animated = Boolean(options.animated);

    const diceHtml = dice
      .map((value, index) => {
        const rotate = animated ? ((index % 2 === 0 ? -1 : 1) * (6 + Math.floor(Math.random() * 10))) : 0;
        const scale = animated ? (1 + Math.random() * 0.08) : 1;
        const translateY = animated ? (-3 + Math.floor(Math.random() * 7)) : 0;

        return `
          <div
            class="die-face die-${tone}${animated ? " is-rolling" : ""}"
            style="
              --die-rotate: ${rotate}deg;
              --die-scale: ${scale};
              --die-translate-y: ${translateY}px;
            "
            aria-label="Terning viser ${value}"
          >
            ${DIE_SYMBOLS[value] || "?"}
          </div>
        `;
      })
      .join("");

    const total = dice.length > 1
      ? `<div class="dice-total">Sum: ${sum(dice)}</div>`
      : "";

    return `
      <div class="dice-row-wrap">
        ${options.label ? `<div class="dice-row-label">${escapeHtml(options.label)}</div>` : ""}
        <div class="dice-row">
          ${diceHtml}
        </div>
        ${total}
      </div>
    `;
  }

  function renderInlineMessage(container, title, message, tone = "warning") {
    container.innerHTML = `
      <h3 class="result-title ${tone}">${escapeHtml(title)}</h3>
      <p class="result-comment">${escapeHtml(message)}</p>
    `;
  }

  function addLogEntry(entry) {
    const timestamp = new Date().toLocaleTimeString("no-NO", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });

    state.rollLog.unshift({
      ...entry,
      timestamp
    });

    state.rollLog = state.rollLog.slice(0, 50);

    saveToStorage(STORAGE_KEYS.log, state.rollLog);
    renderLog();
  }

  function renderLog() {
    if (state.rollLog.length === 0) {
      dom.rollLogList.innerHTML = `
        <li>
          <div class="log-entry-title">
            <span>Ingen kast i loggen</span>
          </div>
          <p class="log-entry-details">Kast vises her når økten starter.</p>
        </li>
      `;
      return;
    }

    dom.rollLogList.innerHTML = state.rollLog
      .map(
        (entry) => `
          <li class="${escapeHtml(entry.type)}">
            <div class="log-entry-title">
              <span>${escapeHtml(entry.title)}</span>
              <time>${escapeHtml(entry.timestamp)}</time>
            </div>
            <p class="log-entry-details">${escapeHtml(entry.details)}</p>
          </li>
        `
      )
      .join("");
  }

  function resetSession() {
    [...dom.modifierList.querySelectorAll("input[type='checkbox']")].forEach((checkbox) => {
      checkbox.checked = false;
    });

    dom.characterNameInput.value = "";
    dom.accuracyInput.value = "0";
    dom.snapShotInput.value = "0";
    dom.distanceInput.value = "";
    dom.speedInput.value = "";
    dom.rangeSpeedModifierInput.value = "0";
    dom.customModifierInput.value = "0";
    dom.manualRollInput.value = "";
    dom.manualRollControls.hidden = true;

    state.rollLog = [];
    saveToStorage(STORAGE_KEYS.log, state.rollLog);

    dom.rollResultCard.innerHTML = `<p class="empty-state">Ingen kast ennå.</p>`;
    dom.damageResultCard.innerHTML = `<p class="empty-state">Skade blir tilgjengelig etter treff eller manuelt våpenvalg.</p>`;

    renderLog();
    updateEffectiveTarget();
  }

  function rollDice(count) {
    return Array.from({ length: count }, () => randomDieValue());
  }

  function randomDieValue() {
    return Math.floor(Math.random() * 6) + 1;
  }

  function sum(numbers) {
    return numbers.reduce((acc, number) => acc + number, 0);
  }

  function wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function readNumber(input, fallbackValue) {
    return readNumberFromValue(input.value, fallbackValue);
  }

  function readNumberFromValue(value, fallbackValue) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallbackValue;
  }

  function clampInteger(value, min, max, fallbackValue) {
    if (!Number.isFinite(value)) {
      return fallbackValue;
    }

    return Math.min(max, Math.max(min, Math.round(value)));
  }

  function formatSignedNumber(value) {
    if (value > 0) {
      return `+${value}`;
    }

    return String(value);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  init();
})();

/* Slutt på fil: app.js | Versjon: 0.3.0 */
