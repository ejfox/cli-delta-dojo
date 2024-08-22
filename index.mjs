#!/usr/bin/env node
import figlet from "figlet";
import chalk from "chalk";
import Chance from "chance";

const chance = new Chance();
const DIFFICULTY = ["NOVICE", "ADEPT", "EXPERT", "MASTER", "CYBERPUNK LEGEND"];
let state = { score: 0, streak: 0, difficulty: 0 };

const genChallenge = (d) => {
  const base = {
    id: chance.guid(),
    name: chance.name(),
    email: chance.email(),
    role: chance.pickone(["user", "admin", "mod", "guest"]),
    created: chance.date({ string: true, american: false }),
    active: chance.bool(),
    age: chance.age(),
    address: {
      street: chance.street(),
      city: chance.city(),
      state: chance.state(),
      zip: chance.zip(),
    },
    phone: chance.phone(),
    company: chance.company(),
    tags: chance.n(chance.word, chance.integer({ min: 1, max: 5 })),
  };

  const diffLikelihood = Math.max(50 - d * 5, 30);
  const isDiff = chance.bool({ likelihood: diffLikelihood });

  const mod = isDiff ? JSON.parse(JSON.stringify(base)) : base;
  const changedFields = [];

  if (isDiff) {
    const changes = d + 1;
    changedFields.push(...chance.pickset(Object.keys(base), changes));
    changedFields.forEach((k) => {
      if (typeof base[k] === "string")
        mod[k] = chance[k] ? chance[k]() : chance.string();
      else if (typeof base[k] === "number")
        mod[k] = chance.integer({ min: base[k] - 5, max: base[k] + 5 });
      else if (typeof base[k] === "boolean") mod[k] = !mod[k];
      else if (Array.isArray(base[k]))
        chance.bool()
          ? mod[k].push(chance.word())
          : (mod[k] = mod[k].filter(() => chance.bool()));
      else {
        const sk = chance.pickone(Object.keys(base[k]));
        mod[k][sk] = chance[sk] ? chance[sk]() : chance.string();
      }
    });
  }

  return { left: base, right: mod, isDiff, changedFields };
};

const verticalSplit = (left, right) => {
  const leftLines = JSON.stringify(left, null, 2).split("\n");
  const rightLines = JSON.stringify(right, null, 2).split("\n");
  const maxLines = Math.max(leftLines.length, rightLines.length);
  const width = process.stdout.columns / 2 - 2;
  let output = "";
  for (let i = 0; i < maxLines; i++) {
    const leftLine = leftLines[i] || "";
    const rightLine = rightLines[i] || "";
    output += leftLine.padEnd(width) + "│ " + rightLine + "\n";
  }
  return output;
};

const render = (ch, tl) => {
  console.clear();
  console.log(
    `SCORE: ${state.score}   STREAK: ${state.streak}   LEVEL: ${
      DIFFICULTY[state.difficulty]
    }   TIME: ${chalk.red("█".repeat(tl) + "░".repeat(30 - tl))}`
  );
  console.log(verticalSplit(ch.left, ch.right));
  console.log(
    "\n[←] Different  or  [→] Same  |  Be quick, agent! The system is watching..."
  );
};

const play = () => {
  const ch = genChallenge(state.difficulty);
  let tl = 30 - state.difficulty * 5;
  const timer = setInterval(() => {
    tl--;
    render(ch, tl);
    if (tl <= 0) {
      clearInterval(timer);
      console.log("\nTime's up, agent! The system caught you.");
      end(false, ch);
    }
  }, 1000);
  render(ch, tl);

  process.stdin.setRawMode(true);
  process.stdin.on("data", (key) => {
    if (key.toString() === "\u001b[D") {
      // Left arrow
      clearInterval(timer);
      end(ch.isDiff, ch);
    } else if (key.toString() === "\u001b[C") {
      // Right arrow
      clearInterval(timer);
      end(!ch.isDiff, ch);
    }
  });
};

const showDifference = (ch) => {
  const output = verticalSplit(ch.left, ch.right).split("\n");
  return output
    .map((line) => {
      if (ch.changedFields.some((field) => line.includes(field))) {
        return chalk.red(line);
      }
      return line;
    })
    .join("\n");
};

const end = (correct, ch) => {
  if (correct) {
    state.score += (state.difficulty + 1) * 10;
    state.streak++;
    console.log("\nNice hack, agent! You bypassed the security.");
  } else {
    state.streak = 0;
    console.log("\nBusted! Your hack was detected.");
    console.log("Here are the differences:");
    console.log(showDifference(ch));
  }
  state.difficulty = Math.min(Math.floor(state.streak / 3), 4);

  console.log("\nPress [→] to continue or [Q] to quit");

  process.stdin.once("data", (key) => {
    if (key.toString() === "\u001b[C") {
      // Right arrow
      play();
    } else if (key.toString().toLowerCase() === "q") {
      console.log(`\nMission complete. Final score: ${state.score}`);
      process.exit();
    } else {
      end(correct, ch); // If any other key is pressed, ask again
    }
  });
};

console.log(figlet.textSync("CLI-DELTA-DOJO", { font: "Standard" }));
console.log(
  "\n[←] Different  or  [→] Same  |  Be quick, agent! The system is watching..."
);
console.log("\nPress any key to start the game...");

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.once("data", () => {
  play();
});
