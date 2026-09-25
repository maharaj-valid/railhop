# 🚆 RailHop

RailHop helps you find **vacant berths after chart preparation** on Indian Railways trains and suggests **seat-hopping combinations** — so you can hop from a bad seat to a better one, even mid-journey.

## ✨ Features

- Proxies IRCTC APIs to fetch real-time vacant seat data after chart preparation
- Suggests seat-hopping paths using **BFS (Breadth-First Search)** — up to 8 hops
- Clean, GapSeat-style vertical step card UI to visualize your hop options
- In-memory caching to reduce redundant API calls
- Rate limiting to avoid hitting IRCTC API limits

## 🛠️ Tech Stack

- **Backend:** Node.js, Express
- **Frontend:** Vanilla JavaScript, HTML, CSS
- **Algorithm:** BFS-based seat hop suggestion engine

## 📁 Project Structure

```
RailHop/
├── algorithm.js       # BFS logic for seat-hopping suggestions
├── app.js              # Frontend logic
├── index.html           # Main UI
├── server.js           # Express backend / IRCTC API proxy
├── style.css            # Styling
├── package.json
└── package-lock.json
```

## 🚀 Getting Started

### Prerequisites
- Node.js installed on your machine

### Installation

```bash
git clone https://github.com/maharaj-valid/RailHop.git
cd RailHop
npm install
```

### Run the app

```bash
npm start
```

Then open `http://localhost:3000` (or the port configured in `server.js`) in your browser.

## ⚠️ Disclaimer

This project interacts with unofficial IRCTC API endpoints for educational purposes. Use responsibly and at your own risk.

## 📄 License

This project is open source and available under the MIT License.
