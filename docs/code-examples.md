# Code Examples: Rust + Lua Implementation

This document provides concrete code examples showing how delta-dojo would be implemented in Rust (core) with Lua (plugins/themes).

## Current Implementation (Node.js)

### Game State (JavaScript)
```javascript
// index.mjs
let state = {
  score: 0,
  streak: 0,
  best: 0,
  round: 0,
  combo: 1,
  perfect: 0,
};

const endRound = async (correct, answer = -1) => {
  clearInterval(timerRef);
  inputLocked = true;
  const elapsed = (Date.now() - startTime) / 1000;
  const elapsedMs = Math.round(elapsed * 1000);
  history.push([answer, elapsedMs]);
  chainState = chainHash(chainState, answer, elapsedMs);
  // ... scoring logic
};
```

---

## Rust Implementation Examples

### 1. Type-Safe Game State

```rust
// src/game.rs

use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Answer {
    Different = 0,
    Same = 1,
    Timeout = -1,
}

#[derive(Debug, Clone)]
pub struct GameState {
    pub score: i32,
    pub streak: i32,
    pub best_streak: i32,
    pub round: i32,
    pub combo: i32,
    pub perfect: i32,
}

impl GameState {
    pub fn new() -> Self {
        Self {
            score: 0,
            streak: 0,
            best_streak: 0,
            round: 0,
            combo: 1,
            perfect: 0,
        }
    }

    pub fn update_correct(&mut self, rating: &Rating) {
        let base_points = 10;
        let points = base_points * rating.multiplier * self.combo;
        
        self.score += points;
        self.streak += 1;
        self.best_streak = self.best_streak.max(self.streak);
        
        if rating.multiplier >= 3 {
            self.combo = (self.combo + 1).min(8);
        }
        
        if rating.label == "PERFECT" {
            self.perfect += 1;
        }
    }

    pub fn update_wrong(&mut self) {
        self.combo = 1;
        self.streak = 0;
    }
}

pub struct Rating {
    pub label: &'static str,
    pub multiplier: i32,
    pub max_time: Duration,
}

impl Rating {
    pub fn from_elapsed(elapsed: Duration) -> &'static Rating {
        const RATINGS: &[Rating] = &[
            Rating { label: "PERFECT", multiplier: 4, max_time: Duration::from_millis(1500) },
            Rating { label: "FAST", multiplier: 3, max_time: Duration::from_millis(3000) },
            Rating { label: "GOOD", multiplier: 2, max_time: Duration::from_millis(5000) },
            Rating { label: "OK", multiplier: 1, max_time: Duration::MAX },
        ];

        RATINGS.iter()
            .find(|r| elapsed <= r.max_time)
            .unwrap()
    }
}
```

**Benefits:**
- Compile-time guarantee that Answer is valid (0, 1, or -1)
- No possibility of typos in field names
- Immutable by default
- Zero-cost abstractions

---

### 2. Challenge Generation

```rust
// src/challenge.rs

use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum DataObject {
    User(UserData),
    Server(ServerData),
    Transaction(TransactionData),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserData {
    pub id: String,
    pub user: String,
    pub email: String,
    pub role: String,
    pub active: bool,
    pub score: i32,
}

pub struct Challenge {
    pub a: DataObject,
    pub b: DataObject,
    pub is_different: bool,
}

pub struct ChallengeGenerator {
    rng: ChaCha8Rng,
}

impl ChallengeGenerator {
    pub fn new(seed: u64) -> Self {
        Self {
            rng: ChaCha8Rng::seed_from_u64(seed),
        }
    }

    pub fn generate(&mut self, difficulty: i32) -> Challenge {
        // Generate base object
        let template_idx = self.rng.gen_range(0..3);
        let base = match template_idx {
            0 => DataObject::User(self.generate_user()),
            1 => DataObject::Server(self.generate_server()),
            _ => DataObject::Transaction(self.generate_transaction()),
        };

        // 55% chance of being different
        let is_different = self.rng.gen_bool(0.55);
        
        let modified = if is_different {
            self.modify_object(&base, difficulty)
        } else {
            base.clone()
        };

        Challenge {
            a: base,
            b: modified,
            is_different,
        }
    }

    fn generate_user(&mut self) -> UserData {
        UserData {
            id: self.random_hex(8),
            user: self.random_name(),
            email: self.random_email(),
            role: *self.choose(&["admin", "user", "mod"]),
            active: self.rng.gen(),
            score: self.rng.gen_range(0..999),
        }
    }

    // ... other generators
}
```

**Benefits:**
- Cryptographically secure RNG (ChaCha8)
- Type-safe enum for different data types
- Deterministic with known seed
- Can verify RNG matches original implementation

---

### 3. Terminal Rendering

```rust
// src/render.rs

use crossterm::{
    cursor, terminal, style::{Color, Attribute, Stylize},
    ExecutableCommand,
};
use std::io::{stdout, Write};

pub struct Renderer {
    terminal_width: u16,
}

impl Renderer {
    pub fn new() -> crossterm::Result<Self> {
        let (width, _) = terminal::size()?;
        Ok(Self { terminal_width: width })
    }

    pub fn render_challenge(&mut self, challenge: &Challenge, show_diff: bool) -> crossterm::Result<()> {
        let mut stdout = stdout();
        
        stdout.execute(terminal::Clear(terminal::ClearType::All))?;
        stdout.execute(cursor::Hide)?;
        stdout.execute(cursor::MoveTo(0, 0))?;

        // Render status line
        self.render_status(&state)?;

        // Render side-by-side panels
        self.render_panels(&challenge.a, &challenge.b, show_diff)?;

        // Render controls
        writeln!(stdout, "\n  {}", "[<-] diff  [->] same".dark_grey())?;
        
        stdout.flush()?;
        Ok(())
    }

    fn render_panels(&self, a: &DataObject, b: &DataObject, show_diff: bool) -> crossterm::Result<()> {
        let panel_width = (self.terminal_width as usize - 7) / 2;
        
        let a_json = serde_json::to_string_pretty(a).unwrap();
        let b_json = serde_json::to_string_pretty(b).unwrap();
        
        let a_lines: Vec<&str> = a_json.lines().collect();
        let b_lines: Vec<&str> = b_json.lines().collect();
        
        let mut stdout = stdout();

        // Top border
        writeln!(stdout, "  ╭{}┬{}╮",
            "─".repeat(panel_width),
            "─".repeat(panel_width))?;
        
        // Headers
        writeln!(stdout, "  │{} a{}│{} b{}│",
            " ".magenta().bold(),
            " ".repeat(panel_width - 2),
            " ".cyan().bold(),
            " ".repeat(panel_width - 2))?;

        // Middle border
        writeln!(stdout, "  ├{}┼{}┤",
            "─".repeat(panel_width),
            "─".repeat(panel_width))?;

        // Content lines
        let max_lines = a_lines.len().max(b_lines.len());
        for i in 0..max_lines {
            let left = a_lines.get(i).unwrap_or(&"");
            let right = b_lines.get(i).unwrap_or(&"");

            if show_diff && left != right {
                let (l_styled, r_styled) = self.diff_line(left, right);
                write!(stdout, "  │{}│{}│\n", l_styled, r_styled)?;
            } else {
                write!(stdout, "  │{:<width$}│{:<width$}│\n",
                    left, right, width = panel_width)?;
            }
        }

        // Bottom border
        writeln!(stdout, "  ╰{}┴{}╯",
            "─".repeat(panel_width),
            "─".repeat(panel_width))?;

        Ok(())
    }

    fn diff_line(&self, a: &str, b: &str) -> (String, String) {
        // Character-level diff with styling
        // Similar to diffChars but with crossterm colors
        use similar::{ChangeTag, TextDiff};
        
        let diff = TextDiff::from_chars(a, b);
        let mut left = String::new();
        let mut right = String::new();

        for change in diff.iter_all_changes() {
            match change.tag() {
                ChangeTag::Delete => {
                    left.push_str(&format!("{}", 
                        change.value()
                            .strikethrough()
                            .magenta()
                            .on_dark_red()));
                }
                ChangeTag::Insert => {
                    right.push_str(&format!("{}", 
                        change.value()
                            .cyan()
                            .on_dark_cyan()));
                }
                ChangeTag::Equal => {
                    left.push_str(change.value());
                    right.push_str(change.value());
                }
            }
        }

        (left, right)
    }
}
```

**Benefits:**
- Native terminal control (no Node.js overhead)
- Type-safe color handling
- Better error handling
- More responsive rendering

---

## Lua Plugin System Examples

### 1. Theme Definition

```lua
-- themes/cyberpunk.lua

return {
  name = "Cyberpunk 2077",
  version = "1.0.0",
  author = "delta-dojo",

  -- Color palette
  colors = {
    primary = {255, 40, 130},      -- Hot pink
    secondary = {0, 255, 255},     -- Cyan
    accent = {255, 230, 0},        -- Yellow
    success = {0, 255, 100},       -- Green
    warning = {255, 150, 0},       -- Orange
    error = {255, 80, 80},         -- Red
    text = {170, 170, 190},        -- Light gray
    dim = {50, 50, 60},            -- Dark gray
  },

  -- UI styling
  ui = {
    border_style = "rounded",      -- "rounded", "sharp", "double"
    
    panel_a = {
      header = "primary",
      text = "text",
    },
    
    panel_b = {
      header = "secondary",
      text = "text",
    },

    diff_removed = {
      fg = "primary",
      bg = {100, 0, 50},
      underline = "dashed",
      strikethrough = true,
    },

    diff_added = {
      fg = "secondary",
      bg = {0, 80, 80},
      underline = "curly",
    },

    status_bar = {
      round = {
        color = "dim",
        prefix = "#",
      },
      score = {
        color = "accent",
      },
      streak = {
        color = "success",
        fire_emoji = "🔥",
        fire_threshold = 5,
      },
      combo = {
        color_normal = "dim",
        color_high = "secondary",
        color_mega = "primary",
        threshold_high = 2,
        threshold_mega = 4,
      },
    },
  },

  -- Rating definitions
  ratings = {
    {
      max_time = 1.5,
      label = "PERFECT",
      color = "primary",
      multiplier = 4,
      play_sound = true,
    },
    {
      max_time = 3.0,
      label = "FAST",
      color = "secondary",
      multiplier = 3,
      play_sound = true,
    },
    {
      max_time = 5.0,
      label = "GOOD",
      color = "success",
      multiplier = 2,
      play_sound = false,
    },
    {
      max_time = math.huge,
      label = "OK",
      color = "dim",
      multiplier = 1,
      play_sound = false,
    },
  },

  -- Visual effects
  effects = {
    flash_on_correct = {
      enabled = true,
      color = {0, 50, 0},
      duration_ms = 40,
    },
    flash_on_wrong = {
      enabled = true,
      color = {60, 0, 0},
      duration_ms = 50,
    },
  },
}
```

**Usage from Rust:**
```rust
// src/theme.rs

use mlua::prelude::*;

pub struct Theme {
    pub colors: HashMap<String, (u8, u8, u8)>,
    pub ratings: Vec<RatingTheme>,
    // ... other fields
}

impl Theme {
    pub fn load(lua: &Lua, path: &Path) -> LuaResult<Self> {
        let theme_code = std::fs::read_to_string(path)?;
        let theme_table: LuaTable = lua.load(&theme_code).eval()?;

        // Parse colors
        let colors_table: LuaTable = theme_table.get("colors")?;
        let mut colors = HashMap::new();
        
        for pair in colors_table.pairs::<String, LuaTable>() {
            let (name, rgb_table) = pair?;
            let r: u8 = rgb_table.get(1)?;
            let g: u8 = rgb_table.get(2)?;
            let b: u8 = rgb_table.get(3)?;
            colors.insert(name, (r, g, b));
        }

        // Parse ratings
        let ratings_table: LuaTable = theme_table.get("ratings")?;
        let mut ratings = Vec::new();
        
        for rating in ratings_table.sequence_values::<LuaTable>() {
            let r = rating?;
            ratings.push(RatingTheme {
                max_time: r.get("max_time")?,
                label: r.get("label")?,
                multiplier: r.get("multiplier")?,
                play_sound: r.get("play_sound")?,
            });
        }

        Ok(Self { colors, ratings })
    }
}
```

---

### 2. Challenge Generator Plugin

```lua
-- plugins/crypto_addresses.lua

return {
  name = "Crypto Address Challenge",
  version = "1.0.0",
  description = "Practice spotting differences in cryptocurrency addresses",
  
  -- Called when plugin is loaded
  init = function(api)
    api.log("Crypto address plugin loaded")
  end,

  -- Generate a challenge at the given difficulty level
  generate = function(rng, difficulty)
    local length = 64
    
    -- Generate a random hex address
    local address = rng.hex(length)
    
    -- Decide if we should make it different
    local is_different = rng.bool(0.6)  -- 60% chance
    local modified = address

    if is_different then
      -- Modify based on difficulty
      if difficulty < 3 then
        -- Easy: change a chunk in the middle
        local start = 25
        modified = address:sub(1, start - 1) .. 
                   rng.hex(10) .. 
                   address:sub(start + 10)
      elseif difficulty < 7 then
        -- Medium: change a few characters scattered
        local chars = {}
        for c in address:gmatch(".") do
          table.insert(chars, c)
        end
        -- Change 3 random positions
        for i = 1, 3 do
          local pos = rng.integer(1, #chars)
          chars[pos] = rng.hex_char()
        end
        modified = table.concat(chars)
      else
        -- Hard: change just 1-2 characters
        local chars = {}
        for c in address:gmatch(".") do
          table.insert(chars, c)
        end
        local pos = rng.integer(#chars / 3, #chars * 2 / 3)
        chars[pos] = rng.hex_char()
        modified = table.concat(chars)
      end
    end

    return {
      a = {
        wallet = address,
        network = rng.choice({"BTC", "ETH", "SOL"}),
      },
      b = {
        wallet = modified,
        network = rng.choice({"BTC", "ETH", "SOL"}),
      },
      is_different = is_different,
    }
  end,
}
```

**Rust Integration:**
```rust
// src/plugin.rs

use mlua::prelude::*;

pub struct PluginManager {
    lua: Lua,
    plugins: Vec<Plugin>,
}

impl PluginManager {
    pub fn new() -> LuaResult<Self> {
        let lua = Lua::new();
        
        // Sandbox: remove dangerous functions
        let globals = lua.globals();
        globals.set("require", LuaNil)?;
        globals.set("dofile", LuaNil)?;
        globals.set("loadfile", LuaNil)?;
        
        // Add safe API
        let api = lua.create_table()?;
        api.set("log", lua.create_function(|_, msg: String| {
            println!("[PLUGIN] {}", msg);
            Ok(())
        })?)?;
        globals.set("api", api)?;

        Ok(Self {
            lua,
            plugins: Vec::new(),
        })
    }

    pub fn load_plugin(&mut self, path: &Path) -> LuaResult<()> {
        let code = std::fs::read_to_string(path)?;
        let plugin_table: LuaTable = self.lua.load(&code).eval()?;

        let name: String = plugin_table.get("name")?;
        let generate_fn: LuaFunction = plugin_table.get("generate")?;

        // Call init if exists
        if let Ok(init_fn) = plugin_table.get::<_, LuaFunction>("init") {
            let api = self.lua.globals().get::<_, LuaTable>("api")?;
            init_fn.call::<_, ()>(api)?;
        }

        self.plugins.push(Plugin {
            name,
            generate_fn,
        });

        Ok(())
    }

    pub fn generate_challenge(&self, difficulty: i32) -> LuaResult<Challenge> {
        if self.plugins.is_empty() {
            // Use default generator
            return Ok(default_challenge(difficulty));
        }

        let plugin = &self.plugins[0];  // Or select based on criteria
        
        // Create RNG table for Lua
        let rng = self.create_rng_api()?;
        
        // Call plugin's generate function
        let result: LuaTable = plugin.generate_fn.call((rng, difficulty))?;

        // Parse result
        let a: LuaTable = result.get("a")?;
        let b: LuaTable = result.get("b")?;
        let is_different: bool = result.get("is_different")?;

        Ok(Challenge {
            a: lua_table_to_json(a)?,
            b: lua_table_to_json(b)?,
            is_different,
        })
    }

    fn create_rng_api(&self) -> LuaResult<LuaTable> {
        let rng = self.lua.create_table()?;
        
        // Add RNG functions
        rng.set("hex", self.lua.create_function(|_, length: usize| {
            use rand::Rng;
            let mut rng = rand::thread_rng();
            let hex: String = (0..length)
                .map(|_| format!("{:x}", rng.gen::<u8>() % 16))
                .collect();
            Ok(hex)
        })?)?;

        rng.set("bool", self.lua.create_function(|_, prob: f64| {
            use rand::Rng;
            Ok(rand::thread_rng().gen_bool(prob))
        })?)?;

        rng.set("integer", self.lua.create_function(|_, (min, max): (i32, i32)| {
            use rand::Rng;
            Ok(rand::thread_rng().gen_range(min..=max))
        })?)?;

        Ok(rng)
    }
}
```

---

### 3. Custom Scoring Plugin

```lua
-- plugins/speed_run_mode.lua

return {
  name = "Speed Run Mode",
  version = "1.0.0",
  description = "Ultra-fast mode with shorter timeouts and bigger penalties",

  -- Override scoring calculation
  calculate_score = function(game_state, is_correct, elapsed_ms)
    if not is_correct then
      return {
        points = -50,              -- Big penalty!
        reset_streak = true,
        reset_combo = true,
      }
    end

    local base = 10
    local mult = 1
    local combo = game_state.combo

    -- Even tighter time windows
    if elapsed_ms < 1000 then
      mult = 6  -- INSANE
    elseif elapsed_ms < 1500 then
      mult = 4  -- EXTREME  
    elseif elapsed_ms < 2000 then
      mult = 2  -- GOOD
    end

    local points = base * mult * combo

    return {
      points = points,
      increase_combo = mult >= 4,
      rating_label = mult == 6 and "INSANE" or 
                     mult == 4 and "EXTREME" or
                     mult == 2 and "GOOD" or "OK",
    }
  end,

  -- Override timeout calculation
  get_timeout = function(streak)
    -- Much shorter timeouts!
    if streak < 3 then
      return 8   -- 8 seconds
    elseif streak < 7 then
      return 6   -- 6 seconds
    else
      return 5   -- 5 seconds minimum
    end
  end,

  -- Override difficulty calculation
  get_difficulty = function(streak)
    -- Ramps up faster
    return math.floor(streak / 2)
  end,
}
```

---

## Comparison: Feature Implementation Effort

### Adding a New Data Template

**Node.js (Current):**
```javascript
// Add to DATA array in index.mjs (~10 lines)
const DATA = [
  // ... existing
  (c) => ({
    file: c.word() + "." + c.pickone(["txt", "md", "js"]),
    size: c.integer({ min: 100, max: 9999 }),
    modified: c.date().toISOString(),
  }),
];
```
**Effort:** 5 minutes

**Rust + Lua:**
```lua
-- Create new plugin file (~30 lines)
return {
  name = "File System",
  generate = function(rng)
    return {
      a = {
        file = rng.word() .. "." .. rng.choice({"txt", "md", "js"}),
        size = rng.integer(100, 9999),
        modified = rng.iso_date(),
      },
      b = { -- same structure },
      is_different = rng.bool(0.55),
    }
  end
}
```
**Effort:** 15 minutes (but more flexible!)

### Changing UI Colors

**Node.js (Current):**
```javascript
// Edit C object in index.mjs
const C = {
  pink: chalk.rgb(255, 40, 130),  // Change RGB values
  cyan: chalk.rgb(0, 255, 255),   // Requires restart
};
```
**Effort:** 2 minutes, restart required

**Rust + Lua:**
```lua
-- Edit theme file
-- themes/custom.lua
colors = {
  primary = {255, 100, 150},  -- Change here
  secondary = {50, 200, 255}, -- Hot reload!
}
```
**Effort:** 1 minute, no restart needed!

---

## Performance Characteristics

### Startup Time Breakdown

**Node.js:**
```
V8 initialization:     40-50ms
Module loading:        20-30ms
Dependency parsing:    10-20ms
Your code execution:   5-10ms
------------------------------
Total:                 75-110ms
```

**Rust:**
```
Binary loading:        5-8ms
Your code execution:   2-5ms
------------------------------
Total:                 7-13ms
```

**Rust + Lua (with plugin):**
```
Binary loading:        5-8ms
Lua initialization:    1-2ms
Plugin loading:        2-3ms
Your code execution:   2-5ms
------------------------------
Total:                 10-18ms
```

### Memory Usage

**Node.js:**
- V8 heap: 10-20MB
- Node runtime: 10-20MB
- Your code: 5-10MB
- **Total: 30-50MB**

**Rust:**
- Binary: 2-3MB
- Runtime allocations: 1-2MB
- **Total: 3-5MB**

**Rust + Lua:**
- Binary: 2.5-3.5MB
- Lua state: 200-500KB
- Plugin allocations: 500KB-1MB
- **Total: 4-7MB**

---

## Conclusion

This document demonstrates:

1. **Rust provides excellent type safety and performance** - but at the cost of development velocity
2. **Lua provides great extensibility** - themes and plugins are easier to create than in JS
3. **Current Node.js code is clean** - no compelling reason to rewrite for correctness
4. **Best path: Add plugins to Node.js first** - prove the value before committing to a rewrite

The code examples show that Rust + Lua would work well technically, but the effort-to-benefit ratio doesn't justify it for delta-dojo's current state and goals.
