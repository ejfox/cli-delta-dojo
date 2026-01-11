# delta-dojo

JSON diff trainer for the terminal. Compare two objects, spot the differences.

## Install

```bash
npm install
```

## Run

```bash
node index.mjs
```

## Controls

- `←` - Objects are different
- `→` - Objects are the same
- `q` - Quit

## Features

- Character-level diff highlighting
- True color support
- Ghostty/Kitty styled underlines (curly, dashed)
- Responsive layout (side-by-side or stacked)
- Multiple data types (user profiles, server configs, transactions, API responses)
- Difficulty scaling based on streak

## Requirements

- Node.js 18+
- Terminal with true color support (Ghostty, Kitty, iTerm2, etc.)

## License

MIT
