# Code Battle – Online Hackathon Portal

Code Battle is a web portal for running an online hackathon. Participants compete in four timed rounds: **Quiz Battle**, **Coding Battle**, **Debugging Battle** and **Final Battle**. Every submission is scored automatically, the top scorers of each round qualify for the next, and everyone can follow the live rankings. Admins run the rounds, manage questions, review and adjust scores, and publish the final leaderboard.

## Features

- Registration and login (passwords hashed with scrypt, httpOnly session cookie)
- Four timed rounds. Each participant's timer starts when they press Start and is enforced by the server
- Quiz round with automatic scoring and auto-submit when time runs out
- Coding, debugging and final rounds in **Python, JavaScript, C++ and Java**, run in a sandbox against hidden test cases, with partial credit per test passed
- Round-by-round qualification: the top N advance, ties at the cut-off included
- Participant dashboard with score, overall rank, per-round rank and recent submissions
- Live leaderboard that refreshes every 10 seconds, then a final results page with a podium
- Admin control room: start and end rounds, add, edit and import questions, review code, override scores, publish results, download a CSV
- Light and dark mode. Layouts for phones, tablets and desktops

## Tech stack

| Part | Choice |
| --- | --- |
| Backend | Node.js 24, Express 5 |
| Database | SQLite through Node's built-in `node:sqlite` (one file, no database server) |
| Frontend | Plain HTML, CSS and JavaScript (no build step), CodeMirror 5 editor |
| Code execution | [Piston](https://github.com/engineer-man/piston), self-hosted in Docker |
| Deployment | Docker Compose |

Free APIs, no keys needed:

- **Piston** runs submitted code in an isolated sandbox. It is self-hosted because the public Piston endpoint requires a key.
- **[Open Trivia DB](https://opentdb.com/api_config.php)** imports computer science quiz questions from the admin panel.
- **[DiceBear](https://www.dicebear.com/)** draws the initials avatars on the leaderboard.

---

## Installation

### Option A: Docker (recommended)

This runs the portal and the code runner together.

**Prerequisites**

- [Git](https://git-scm.com/downloads)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) on Windows or macOS, or Docker Engine with the Compose plugin on Linux. The host needs cgroup v2, which current Docker Desktop and modern Linux distributions use.
- About 2 GB of free disk space for the language runtimes

**Steps**

1. Clone the repository.

   ```bash
   git clone https://github.com/mithil98/code-battle.git
   cd code-battle
   ```

2. Create your settings file and choose an admin password.

   ```bash
   cp .env.example .env
   ```

   On Windows PowerShell, use `Copy-Item .env.example .env`. Then open `.env` and set `ADMIN_PASSWORD`. If you leave it empty, a random password is printed in the logs on first boot.

3. Start Docker Desktop, then build and start the containers.

   ```bash
   docker compose up -d --build
   ```

4. Wait for the language runtimes to install. This happens on the first boot only and takes a few minutes.

   ```bash
   docker compose logs -f app
   ```

   Wait until you see `Installed java ...`, then press `Ctrl+C` to stop following the logs.

5. Open **http://localhost:3000** and log in as `admin@codebattle.local` (or your `ADMIN_EMAIL`) with your admin password. The Control room should show **Code runner online, 4 languages**.

**Everyday commands**

| Task | Command |
| --- | --- |
| Stop | `docker compose down` |
| Start again | `docker compose up -d` |
| Update after `git pull` | `docker compose up -d --build` |
| See logs | `docker compose logs -f app` |
| Delete all data, including users and scores | `docker compose down -v` |

Data is stored in Docker volumes: `app-data` holds the database and `piston-packages` holds the language runtimes. Both survive restarts.

To let other people on your network use the portal, share `http://<your-computer-ip>:3000`. You may need to allow that port in your firewall.

### Option B: Node.js without Docker (development)

Use this to work on the code. Code submissions still need a Piston instance.

**Prerequisites:** Node.js 22.13 or newer (24 recommended) and Docker for the code runner.

1. Install the dependencies and run the tests.

   ```bash
   npm install
   npm test
   ```

2. Start only the code runner and expose it to your machine.

   ```bash
   docker run -d --name piston --privileged -p 2000:2000 --tmpfs /tmp:exec -v piston-packages:/piston/packages ghcr.io/engineer-man/piston
   ```

3. Start the portal.

   ```bash
   # macOS / Linux
   ADMIN_PASSWORD=choose-a-password PISTON_URL=http://localhost:2000 npm start
   ```

   ```powershell
   # Windows PowerShell
   $env:ADMIN_PASSWORD="choose-a-password"; $env:PISTON_URL="http://localhost:2000"; npm start
   ```

4. Open http://localhost:3000. The database is created as `codebattle.db` in the project folder.

### Troubleshooting

| Problem | Fix |
| --- | --- |
| Admin page says **Code runner offline** | Run `docker compose ps` to check that `piston` is running, and `docker compose logs piston` for errors. Piston needs `privileged: true` and cgroup v2. |
| Submissions return "code runner is unavailable" | The language runtimes are still installing. Check with `docker compose logs app`. |
| Port 3000 is already in use | Set `PORT=3100` in `.env`, run `docker compose up -d`, and open http://localhost:3100. |
| Forgot the admin password | Run `docker compose down -v` to wipe the data, set `ADMIN_PASSWORD` in `.env`, then start again. This deletes all users and scores. |
| Fonts, icons or the code editor do not load | Participants' browsers need internet access, because these load from public CDNs. |

---

## Running the event

1. **Admin → Rounds:** set Quiz Battle to *Live*.
2. Participants register, open the round from their dashboard and press **Start round**.
3. When time is over, press **End and qualify**. The top N in the *Qualify top* column unlock the next round.
4. Set the next round to *Live* and repeat. The Final Battle has no qualify count.
5. **Submissions:** review code and adjust scores if needed. **Results:** publish the final leaderboard and download a CSV.

Add your own questions under **Admin → Questions**, or import quiz questions from Open Trivia DB. Code questions read from standard input and print to standard output. Each one has starter code per language and JSON test cases, which can be hidden from participants.

## Scoring

- **Quiz:** points for each correct answer. One submission, auto-submitted when time runs out.
- **Code rounds:** `points × tests passed ÷ total tests`. Unlimited submissions until the deadline. Your best score per problem counts.
- **Total** is the sum of all rounds. Equal totals share a rank.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DB_FILE` | `codebattle.db` (`/data/codebattle.db` in Docker) | SQLite file |
| `ADMIN_EMAIL` | `admin@codebattle.local` | Admin login created on first boot |
| `ADMIN_PASSWORD` | random, printed once | Admin password on first boot |
| `PISTON_URL` | `http://localhost:2000` (`http://piston:2000` in Docker) | Code runner address |
| `COOKIE_SECURE` | `0` | Set to `1` when served over HTTPS |
| `SUBMIT_COOLDOWN_MS` | `3000` | Minimum gap between code submissions per participant |

## Project structure

```
server.js      Express app and all API routes
db.js          SQLite schema, password hashing, first-boot seeding
seed.js        Default rounds and questions
scoring.js     Leaderboard, ranks and qualification queries
runner.js      Piston client: runs code against test cases
public/        HTML pages, style.css and page scripts in public/js/
test/          API and runner tests (node:test)
```

## Tests

```bash
npm test
```

The tests use an in-memory database and a fake code runner, so Docker is not needed. To check a real Piston instance in all four languages:

```bash
PISTON_LIVE=http://localhost:2000 node --test test/runner.test.js
```
