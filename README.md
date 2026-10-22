# ⚡ EnergySense - IoT Based Smart Energy Monitoring System

**Track • Analyse • Save • Build a Sustainable Future**

EnergySense is a professional, industrial-grade web application and dashboard for real-time electrical telemetry monitoring. It seamlessly integrates with physical **ESP32 + PZEM-004T** hardware transmitting data to **ThingSpeak Cloud**.

---

## 🏛️ System Architecture

```text
  ┌──────────────┐
  │  PZEM-004T   │ (Measures V, I, P, E, Hz, PF)
  └──────┬───────┘
         │ UART (Modbus)
  ┌──────▼───────┐
  │    ESP32     │ (Controller)
  └──────┬───────┘
         │ Wi-Fi (802.11 b/g/n)
  ┌──────▼───────┐
  │  ThingSpeak  │ (Cloud IoT Broker)
  └──────┬───────┘
         │ Secure Read API Proxy
  ┌──────▼───────┐
  │ Flask Server │ (Backend API on http://localhost:5000)
  └──────┬───────┘
         │ REST / JSON
  ┌──────▼───────┐
  │  EnergySense │ (Modern Responsive Dashboard)
  └──────────────┘
```

---

## 📋 ThingSpeak Field Mapping

| Field | Parameter | Unit | Description |
| :--- | :--- | :--- | :--- |
| **Field 1** | Voltage | `V` | AC Mains Voltage |
| **Field 2** | Current | `A` | Load Current Draw |
| **Field 3** | Power | `W` | Real Active Power |
| **Field 4** | Energy | `kWh` | Cumulative Energy / Units from PZEM memory |
| **Field 5** | Frequency | `Hz` | AC Mains Grid Frequency (Nominal 50 Hz) |
| **Field 6** | Power Factor | - | Quality Index (0.00 to 1.00) |
| **Field 7** | Bill Amount | `₹` | TNEB Domestic Tariff slab-computed bill amount |

### ⚡ TNEB Domestic Tariff Slabs (ESP32 Firmware Logic)

- **0 – 200 Units**: FREE (`₹0.00`)
- **201 – 400 Units**: `₹4.70 / Unit` (computed on units above 200)
- **401 – 500 Units**: `200 × ₹4.70 + (Units - 400) × ₹6.30`
- **Above 500 Units**: `300 × ₹4.70 + 100 × ₹6.30 + (Units - 500) × ₹8.40`

---

## 🚀 Getting Started

### 1. Prerequisites
- Python 3.9+ installed on your system.
- ESP32 + PZEM-004T hardware or a configured ThingSpeak channel.

### 2. Install Dependencies
Open a terminal in the project root directory and run:

```bash
cd d:\iot_project
pip install -r backend/requirements.txt
```

---

### 3. Configure ThingSpeak Credentials

You have two easy ways to configure your credentials:

#### Option A: Via the `.env` file (Recommended for deployment)
Open the `.env` file in the project root and fill in your values:

```env
THINGSPEAK_CHANNEL_ID=YOUR_NUMERIC_CHANNEL_ID
THINGSPEAK_READ_API_KEY=YOUR_16_CHAR_READ_API_KEY

DATA_TIMEOUT=60
REFRESH_INTERVAL=15
```

> **Security Note:** Only supply the **READ API Key**. Never expose your Write API Key to the web dashboard.

#### Option B: Via the EnergySense Web Settings UI
You can start the server directly and enter your Channel ID and Read API Key under the **Settings** menu. The web app will save and persist your settings automatically.

---

### 4. Start the Application

Run the backend application server:

```bash
python backend/app.py
```

Open your browser and navigate to:
👉 **[http://localhost:5000](http://localhost:5000)**

---

## 🔍 Verification & Testing Guide

### A. Testing with Physical ESP32 Hardware
1. Power ON your ESP32 with the PZEM-004T sensor connected to an AC load.
2. Confirm the ESP32 connects to Wi-Fi and begins uploading readings to ThingSpeak (e.g., every 15-20s).
3. Open the **EnergySense Dashboard** (`http://localhost:5000`).
4. You will observe:
   - Topbar status transitions to **ESP32 Online** (glowing green dot).
   - **Wi-Fi / Data Link** card displays **● Connected**.
   - **ThingSpeak** displays **● Updating**.
   - Live KPI cards display true electrical readings (Voltage, Current, Power, Energy, etc.).
   - Multi-axis charts display the historical trend of your active electrical load.

### B. Verifying Dynamic Offline Status
1. Turn OFF or disconnect the power to your ESP32.
2. Wait for `DATA_TIMEOUT` (default: 60 seconds).
3. The dashboard will automatically update without page reload:
   - Topbar badge transitions to **ESP32 Offline** (red dot).
   - Device Status card updates to **ESP32: OFFLINE**, **Data Link: INACTIVE**, **ThingSpeak: NOT UPDATING**.
   - The timestamp of the *last known successful feed* remains preserved.

### C. Optional Simulator (Testing without Hardware)
If you wish to test or demonstrate the dashboard when hardware is unavailable, run the included simulator:

```bash
python simulate_esp32.py --write_key YOUR_THINGSPEAK_WRITE_API_KEY
```

---

## 🖥️ Dashboard Views

1. **Dashboard Overview**:
   - Hero banner with sustainability stats.
   - 6 KPI cards with safe value formatting: Voltage, Current, Active Power, Cumulative Energy, Bill Amount, and Sustainability Index.
   - Interactive Live Trend chart (Voltage, Current, Power) with 10/20/50 range selector.
   - Energy Consumption chart with daily & monthly estimates.
   - Dynamic Device Status card & Real-time Quick Insights.
   - Non-intrusive system alert warnings (NO SMS).

2. **Live Data**:
   - High-resolution gauge cards with Min/Max tracking for Voltage, Current, Power, and Energy.
   - Live streaming waveform (Power & Current).
   - Real-time ThingSpeak Feed Packets Table.

3. **Analytics**:
   - 4 standalone parameter charts: Power, Cumulative Energy, Voltage Stability (230V reference), and Current Draw.
   - Peak load, average voltage, and energy accumulation statistics.

4. **Bill & Cost**:
   - Primary bill presentation synced with ThingSpeak Field 7 (ESP32 calculated bill).
   - TNEB Domestic Tariff slab breakdown.
   - Projected daily, weekly, and monthly cost models.
   - Energy efficiency recommendations.

5. **Device Status & Diagnostics**:
   - End-to-end interactive system topology diagram.
   - Telemetry health inspector, feed age counter, and hardware troubleshooting checklist.

6. **Settings**:
   - ThingSpeak Channel ID & Masked Read API Key management.
   - Polling refresh rate & timeout configurator.
   - Live connection test tool.

---

## 🔒 Security & Best Practices

- **Zero Write Key Exposure**: The web application only accepts and communicates via the Read API Key.
- **Backend Masking**: API keys are masked when transmitted to the frontend.
- **Graceful Error Handling**: Handles network dropouts and ThingSpeak rate limits without breaking dashboard state.
