# SecureAuth — Banking Portal with Behavioral Biometrics

SecureAuth is a modern banking authentication and transaction monitoring platform built with **Next.js 15**, **Prisma**, **Neon PostgreSQL**, and an integrated **Machine Learning anomaly detection pipeline**. 

It uses behavioral biometrics—specifically **keystroke dynamics** (manual typing patterns) and **cursor telemetry** (mouse movement patterns)—to evaluate user risk in real-time, preventing automated bot attacks, credential stuffing, and session hijacking.

---

## 🚀 Key Features

* **Behavioral Biometrics (Keystroke Dynamics):** Captures timing intervals, typing speeds, and consistency metrics during login and compares them with the user's registered baseline using a custom comparison algorithm.
* **Cursor Tracking & Telemetry:** Monitors clicks, scrolls, mouse movements, and active time-on-page to feed user session batches to the ML pipeline.
* **Real-time Anomaly Detection (Random Forest):** A background batch worker process evaluates behavioral metrics against a trained Random Forest classifier model to output anomaly scores, risk levels (Low, Medium, High), and risk reasons.
* **Edge-Router Security (Middleware):** Protects dashboard routes at the server-edge, preventing any content flashing or unauthorized page rendering.
* **Secured Transaction Flow:** Simulates UPI transactions while checking risk profiles. High-risk transactions are instantly blocked; medium-risk transactions prompt for password re-verification; low-risk transactions complete instantly.
* **Probabilistic DB Garbage Collection:** Cleans up expired sessions in the background on demand without relying on heavy system services.

---

## 🛠️ Architecture Overview

```
├── app/                           # Next.js App Router Pages & API Routes
│   ├── api/
│   │   ├── auth/                  # Login, Signup, Session, Token verification
│   │   ├── model-input/           # Collects cursor/keystroke data batches
│   │   ├── model-output/          # Exposes anomaly predictions
│   │   └── transactions/          # Submits and monitors transactions
│   └── dashboard/                 # Secure banking client views
├── components/                    # React UI components (Dashboard, Chart, Sidebar, etc.)
├── contexts/                      # State providers (AuthContext, TransactionEvents)
├── final_production_model/        # Random Forest ML model, scikit-learn scaler & pickles
│   ├── predict_batch.py           # Python batch prediction script
│   └── requirements.txt           # Python dependency requirements
├── hooks/                         # React hooks (useSessionBatch telemetry collector)
├── lib/                           # Core utilities (auth helpers, prisma client, session managers)
├── prisma/                        # Database schema & migrations
└── scripts/                       # Background services
    ├── batch_model_cron.js        # Scheduler runs worker every 10 seconds
    └── batch_model_worker.js      # Processes modelInput, predicts, saves to modelOutput
```

---

## ⚙️ Prerequisites

* **Node.js** (v18.x or later)
* **Python** (v3.10 or later)
* **PostgreSQL Database** (Neon DB, local instance, etc.)

---

## 📦 Setup Instructions

### 1. Clone the project and install Node dependencies:
```sh
npm install
```

### 2. Install Python model requirements:
```sh
pip install -r final_production_model/requirements.txt
```

### 3. Setup Environment Configuration:
Create a `.env` file in the root directory (based on `.env` template):
```env
# PostgreSQL connection string
DATABASE_URL="your-postgresql-url"

# Cryptographically strong secrets (64-character hex recommended)
JWT_SECRET="your-strong-jwt-secret"
COOKIE_SECRET="your-strong-cookie-secret"

# JWT Expiration in seconds (24 hours)
JWT_EXPIRES_IN="86400"
```

### 4. Migrate database schema:
Deploy the Prisma database schema and migrations to your PostgreSQL target:
```sh
npx prisma migrate deploy
```

---

## 🏃 Run the Application

To run the full SecureAuth system, you need to run the **Next.js Web Server** and the **ML Batch Cron Scheduler** concurrently:

### Terminal 1: Start Next.js Development Server
```sh
npm run dev
```
*App will boot up on [http://localhost:3000](http://localhost:3000).*

### Terminal 2: Start the ML Prediction Cron Scheduler
```sh
node scripts/batch_model_cron.js
```
*Monitors client interactions, processes batches, and writes anomaly scores to the database every 10 seconds.*

---

## 🛡️ Testing Anomalies & Fraud Alerts

1. **Low Risk Profile:** Interact with the dashboard naturally (move mouse, click cards, make normal transactions). Anomaly scores will remain low, and transactions will process instantly.
2. **Medium Risk Profile (Re-verification):** Try typing inconsistently or using a proxy location. Medium risk alerts will trigger a password re-entry modal on transactions.
3. **High Risk Profile (Blocked):** Leave the tab idle without any clicks or mouse movements for 10-20 seconds (simulates a headless browser script). The background worker will detect zero mouse/touch velocity, push a **High Risk** alert to the database, and you will see the **Red Anomaly Alert Card** appear in the dashboard. Any transaction submitted during this phase is instantly blocked.
