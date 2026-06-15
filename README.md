# ai

Notes and operating profiles on working with AI coding agents.

- **[Fable5.md](Fable5.md)** — a portable operating instruction set: how Fable 5
  thinks, decides, builds, and communicates, written as standalone instructions
  in its own grain. Verify before you claim, keep changes in scope and
  reversible, lead with a recommendation at forks, ground advice in the project's
  own data, and close with an honest state-of-the-world. Attach it to any capable
  model to make its output work the way Fable does.
- **[findings.md](findings.md)** — a controlled A/B/C field test of these
  instructions (none / previous / current) on a real codebase: where they change
  a coding agent's output, where they don't, and where they're worth the cost.

## Install

One block — no clone needed. It downloads `Fable5.md` into your Claude config
directory and attaches it to [Claude Code](https://claude.com/claude-code). Run
it from anywhere:

```bash
# Download Fable5.md into ~/.claude, then wire it up.
mkdir -p ~/.claude
curl -fsSL https://raw.githubusercontent.com/sgup/ai/main/Fable5.md -o ~/.claude/Fable5.md

FABLE="$HOME/.claude/Fable5.md"
append_once() { grep -qxF "$2" "$1" 2>/dev/null || printf '%s\n' "$2" >> "$1"; }

# 1. Always-on: import into your global Claude Code instructions (every session).
touch ~/.claude/CLAUDE.md
append_once ~/.claude/CLAUDE.md "@~/.claude/Fable5.md"

# 2. Optional launcher: `ccfable` starts Claude with Fable in the system prompt.
append_once ~/.zshrc "alias ccfable='claude --append-system-prompt-file $FABLE'"
# bash users: swap ~/.zshrc for ~/.bashrc

echo "Done. Open a new terminal (or 'source ~/.zshrc') to use: ccfable"
```

Re-running is safe: the file is refreshed and each line is added only if it
isn't already there. Want to read it before you install? Open
[Fable5.md](Fable5.md), or `curl` the
[raw file](https://raw.githubusercontent.com/sgup/ai/main/Fable5.md) to your
screen first.

### What the two methods do

- **Import** (`@~/.claude/Fable5.md` in `~/.claude/CLAUDE.md`) — loaded into
  *every* Claude Code session automatically, as part of your own instructions.
  This is all most people need.
- **`ccfable` alias** — launches Claude with `--append-system-prompt-file`,
  injecting `Fable5.md` into that session's system prompt on demand. Use it if
  you'd rather opt in per launch than have it always on. Doing both is harmless
  but redundant.

### Update / uninstall

- **Update:** re-run the `curl` line above — it overwrites `~/.claude/Fable5.md`
  with the latest.
- **Uninstall:** `rm ~/.claude/Fable5.md`, then delete the `@~/.claude/Fable5.md`
  line from `~/.claude/CLAUDE.md` and the `ccfable` alias from `~/.zshrc`.

## License

MIT — see [LICENSE](LICENSE).
