"""

EnergySense - IoT Based Smart Energy Monitoring System

Backend API Server (Flask)

Features:

- Secure proxy to ThingSpeak Read API (no frontend credential leakage)

- Dynamic device & connection status determination using feed timestamps

- Safe number parsing and validation (no NaN/null outputs)

- Analytics & historical feed endpoints

- Configuration management

- Static file server for modern frontend dashboard

"""

import os

import sys

from datetime import datetime, timezone

from zoneinfo import ZoneInfo

from pathlib import Path

import requests

from flask import Flask, jsonify, request, send_from_directory

from flask_cors import CORS
import time

from anomaly_service import predict_reading
from telegram_service import send_telegram_alert

if hasattr(sys.stdout, "reconfigure"):

    sys.stdout.reconfigure(encoding="utf-8")

IST = ZoneInfo("Asia/Kolkata")

# Add parent directory to path to load config

current_dir = Path(__file__).resolve().parent

sys.path.insert(0, str(current_dir))

from config import Config

app = Flask(__name__, static_folder="../frontend", static_url_path="")

CORS(app)

# In-memory cache for last valid reading to handle temporary network blips gracefully

last_valid_state = {

    "data": None,

    "last_successful_timestamp": None,

    "last_successful_time_str": None,

    "is_configured": False

}

# ML anomaly alert tracking. This is in-memory and resets when Flask restarts.
last_processed_entry_id = None
last_alert_time = 0.0
ALERT_COOLDOWN_SECONDS = 300  # 5 minutes

def process_energy_anomaly(voltage, current, power, entry_id):
    """Predict a reading and send one Telegram alert per abnormal feed entry."""
    global last_processed_entry_id, last_alert_time

    result = {"status": "UNAVAILABLE", "score": None, "alert_sent": False}
    if entry_id is None or voltage is None or current is None or power is None:
        return result

    # The dashboard polls repeatedly; process each ThingSpeak entry once.
    if str(entry_id) == str(last_processed_entry_id):
        return result
    last_processed_entry_id = str(entry_id)

    try:
        prediction = predict_reading(voltage, current, power)
        result["status"] = prediction["status"]
        result["score"] = prediction["score"]

        if prediction["status"] != "ABNORMAL":
            return result

        now = time.time()
        if now - last_alert_time < ALERT_COOLDOWN_SECONDS:
            return result

        message = (
            "EnergySense Alert: unusual energy reading detected.\n"
            f"Voltage: {voltage} V\n"
            f"Current: {current} A\n"
            f"Power: {power} W\n"
            f"ThingSpeak entry: {entry_id}\n"
            "Please verify the readings and inspect the electrical system if needed."
        )
        if send_telegram_alert(message):
            last_alert_time = now
            result["alert_sent"] = True
    except Exception as error:
        # Keep the dashboard API available if ML or Telegram fails.
        print("Anomaly alert error:", error)

    return result

def parse_float_safe(val, default=None):

    """Safely parse a float value, handling null, empty, strings, or invalid numbers."""

    if val is None:

        return default

    try:

        val_str = str(val).strip()

        if val_str == "" or val_str.lower() in ("nan", "null", "none", "--"):

            return default

        return round(float(val_str), 2)

    except (ValueError, TypeError):

        return default

def parse_iso_time(ts_str):

    """Parse ThingSpeak ISO timestamp (e.g., 2026-09-20T07:15:30Z) into UTC datetime."""

    if not ts_str:

        return None

    try:

        # Standard ISO 8601 parsing as UTC

        cleaned = ts_str.replace("Z", "+00:00")

        dt_utc = datetime.fromisoformat(cleaned)

        if dt_utc.tzinfo is None:

            dt_utc = dt_utc.replace(tzinfo=timezone.utc)

        return dt_utc

    except Exception:

        return None

def calculate_tneb_bill(units):

    """

    TNEB Tariff Slab Calculation matching ESP32 Arduino firmware:

    0 - 200 units     : FREE (0)

    201 - 400 units   : (units - 200) * 4.70

    401 - 500 units   : (200 * 4.70) + ((units - 400) * 6.30)

    Above 500 units   : (300 * 4.70) + (100 * 6.30) + ((units - 500) * 8.40)

    """

    if units is None:

        return None

    try:

        units = float(units)

    except (ValueError, TypeError):

        return None

    if units < 0:

        units = 0.0

    if units <= 200:

        bill = 0.0

    elif units <= 400:

        bill = (units - 200.0) * 4.70

    elif units <= 500:

        bill = (200.0 * 4.70) + ((units - 400.0) * 6.30)

    else:

        bill = (300.0 * 4.70) + (100.0 * 6.30) + ((units - 500.0) * 8.40)

    return round(bill, 2)

def get_tneb_breakdown(units):

    """Generate detailed slab-wise breakdown for TNEB tariff model."""

    if units is None or units < 0:

        u = 0.0

    else:

        u = float(units)

    if u <= 200:

        active_slab = 1

        s1_u, s1_c = u, 0.0

        s2_u, s2_c = 0.0, 0.0

        s3_u, s3_c = 0.0, 0.0

        s4_u, s4_c = 0.0, 0.0

    elif u <= 400:

        active_slab = 2

        s1_u, s1_c = 200.0, 0.0

        s2_u = u - 200.0

        s2_c = round(s2_u * 4.70, 2)

        s3_u, s3_c = 0.0, 0.0

        s4_u, s4_c = 0.0, 0.0

    elif u <= 500:

        active_slab = 3

        s1_u, s1_c = 200.0, 0.0

        s2_u, s2_c = 200.0, round(200.0 * 4.70, 2)

        s3_u = u - 400.0

        s3_c = round(s3_u * 6.30, 2)

        s4_u, s4_c = 0.0, 0.0

    else:

        active_slab = 4

        s1_u, s1_c = 0.0, 0.0  # Under >500 tier formula in firmware: 300 @ 4.70 + 100 @ 6.30 + rem @ 8.40

        s2_u, s2_c = 300.0, round(300.0 * 4.70, 2)

        s3_u, s3_c = 100.0, round(100.0 * 6.30, 2)

        s4_u = u - 500.0

        s4_c = round(s4_u * 8.40, 2)

    total = round(s1_c + s2_c + s3_c + s4_c, 2)

    return {

        "active_slab": active_slab,

        "total_bill": total,

        "slabs": [

            {"slab": "Slab 1 (0 - 200 Units)", "rate": "FREE (₹0.00)", "units": s1_u, "cost": s1_c, "is_active": active_slab == 1},

            {"slab": "Slab 2 (201 - 400 Units)", "rate": "₹4.70 / Unit", "units": s2_u, "cost": s2_c, "is_active": active_slab == 2},

            {"slab": "Slab 3 (401 - 500 Units)", "rate": "₹6.30 / Unit", "units": s3_u, "cost": s3_c, "is_active": active_slab == 3},

            {"slab": "Slab 4 (Above 500 Units)", "rate": "₹8.40 / Unit", "units": s4_u, "cost": s4_c, "is_active": active_slab == 4},

        ]

    }

def calculate_status(feed_time, timeout_seconds):

    """

    Calculate dynamic device status based on ThingSpeak latest feed timestamp.

    Logic:

    - If feed exists and age <= timeout:

        ESP32: ONLINE

        Data Link: CONNECTED (Inferred from recent ThingSpeak update)

        ThingSpeak: UPDATING

    - If feed exists but age > timeout:

        ESP32: OFFLINE

        Data Link: INACTIVE

        ThingSpeak: NOT UPDATING

    """

    if not feed_time:

        return {

            "esp32": "OFFLINE",

            "data_link": "INACTIVE",

            "thingspeak": "NO DATA",

            "is_online": False,

            "age_seconds": None,

            "message": "No data feed found"

        }

    now_utc = datetime.now(timezone.utc)

    age_seconds = (now_utc - feed_time).total_seconds()

    # Handle slight clock drift (if age is slightly negative)

    if age_seconds < 0:

        age_seconds = 0

    is_online = age_seconds <= timeout_seconds

    if is_online:

        return {

            "esp32": "ONLINE",

            "data_link": "CONNECTED",

            "thingspeak": "UPDATING",

            "is_online": True,

            "age_seconds": round(age_seconds),

            "message": f"Active (last feed {round(age_seconds)}s ago)"

        }

    else:

        return {

            "esp32": "OFFLINE",

            "data_link": "INACTIVE",

            "thingspeak": "NOT UPDATING",

            "is_online": False,

            "age_seconds": round(age_seconds),

            "message": f"Device inactive (last feed {round(age_seconds)}s ago)"

        }

def calculate_insights(voltage, current, power, energy, history_feeds=None):

    """

    Calculate engineering insights based on real electrical parameters:

    - Usage Status: High Usage if power exceeds threshold, else Normal.

    - Efficiency: Based on Voltage stability (Nominal 230V range).

    - Trend: Increasing / Stable / Decreasing based on recent power readings.

    """

    # 1. Usage Status

    if power is not None:

        if power > 2000.0:

            usage_status = "High Usage"

            usage_badge = "warning"

            usage_desc = "Power load is elevated (> 2.0 kW)"

        elif power > 800.0:

            usage_status = "Moderate"

            usage_badge = "info"

            usage_desc = "Normal household / appliance load"

        elif power > 0:

            usage_status = "Light Load"

            usage_badge = "success"

            usage_desc = "Low baseline energy consumption"

        else:

            usage_status = "Idle"

            usage_badge = "neutral"

            usage_desc = "No active power draw detected"

    else:

        usage_status = "Unknown"

        usage_badge = "neutral"

        usage_desc = "Waiting for power readings"

    # 2. Efficiency based on Voltage Stability

    if voltage is not None:

        if 215.0 <= voltage <= 245.0:

            efficiency = "Good"

            efficiency_badge = "success"

            efficiency_desc = f"Optimal Grid Voltage ({voltage} V) - Stable nominal supply"

        elif 195.0 <= voltage < 215.0 or 245.0 < voltage <= 255.0:

            efficiency = "Moderate"

            efficiency_badge = "warning"

            efficiency_desc = f"Moderate Voltage Fluctuation ({voltage} V)"

        else:

            efficiency = "Low"

            efficiency_badge = "danger"

            efficiency_desc = f"Abnormal Grid Voltage ({voltage} V)"

    else:

        efficiency = "Unknown"

        efficiency_badge = "neutral"

        efficiency_desc = "Voltage data not available"

    # 3. Trend analysis from historical power readings

    trend = "Stable"

    trend_direction = "flat"

    if history_feeds and len(history_feeds) >= 3:

        valid_powers = []

        for f in history_feeds[-5:]:

            p = parse_float_safe(f.get("field3"))

            if p is not None:

                valid_powers.append(p)

        if len(valid_powers) >= 3:

            first_avg = sum(valid_powers[:2]) / 2.0

            last_avg = sum(valid_powers[-2:]) / 2.0

            diff = last_avg - first_avg

            if diff > 30.0:

                trend = "Increasing"

                trend_direction = "up"

            elif diff < -30.0:

                trend = "Decreasing"

                trend_direction = "down"

            else:

                trend = "Stable"

                trend_direction = "flat"

    # 4. Active Dashboard Alerts (strictly in-dashboard, NO SMS)

    alerts = []

    if voltage is not None:

        if voltage > 255.0:

            alerts.append({"type": "danger", "title": "Overvoltage Warning", "message": f"Grid voltage is critically high at {voltage} V (Nominal: 230 V)."})

        elif voltage < 195.0 and voltage > 10.0:

            alerts.append({"type": "warning", "title": "Undervoltage Alert", "message": f"Grid voltage dropped to {voltage} V. Sensitive equipment may be affected."})

    if power is not None and power > 3500.0:

        alerts.append({"type": "danger", "title": "High Power Surge", "message": f"Current load {power} W exceeds standard 16A circuit capacity."})

    return {

        "usage_status": usage_status,

        "usage_badge": usage_badge,

        "usage_desc": usage_desc,

        "efficiency": efficiency,

        "efficiency_badge": efficiency_badge,

        "efficiency_desc": efficiency_desc,

        "trend": trend,

        "trend_direction": trend_direction,

        "alerts": alerts

    }

# ==============================================================================

# API Routes

# ==============================================================================

@app.route("/")

def index():

    """Serve the single page frontend dashboard."""

    return send_from_directory(app.static_folder, "index.html")

@app.route("/<path:path>")

def static_proxy(path):

    """Serve static frontend assets (css, js, assets)."""

    return send_from_directory(app.static_folder, path)

@app.route("/api/status", methods=["GET"])

def api_status():

    """Health check endpoint."""

    settings = Config.get_settings()

    has_credentials = bool(settings["channel_id"] and settings["read_api_key"])

    return jsonify({

        "status": "online",

        "app": "EnergySense",

        "has_credentials": has_credentials,

        "channel_id": settings["channel_id"]

    })

@app.route("/api/settings", methods=["GET", "POST"])

def api_settings():

    """Get masked settings or update settings."""

    if request.method == "POST":

        data = request.get_json() or {}

        try:

            updated = Config.update_settings(

                channel_id=data.get("channel_id"),

                read_api_key=data.get("read_api_key"),

                data_timeout=data.get("data_timeout"),

                refresh_interval=data.get("refresh_interval")

            )

            return jsonify({

                "success": True,

                "message": "Settings saved successfully",

                "settings": updated

            })

        except Exception as e:

            return jsonify({

                "success": False,

                "error": str(e)

            }), 400

    # GET request

    return jsonify(Config.get_masked_settings())

@app.route("/api/energy/latest", methods=["GET"])

def api_energy_latest():

    """

    Fetches the latest reading from ThingSpeak.

    Field Mappings:

      Field 1 = Voltage (V)

      Field 2 = Current (A)

      Field 3 = Power (W)

      Field 4 = Energy (kWh)

      Field 7 = Bill Amount (₹)

    """

    settings = Config.get_settings()

    channel_id = settings["channel_id"]

    read_api_key = settings["read_api_key"]

    timeout_sec = settings["data_timeout"]

    if not channel_id or not read_api_key:

        return jsonify({

            "status": "unconfigured",

            "is_configured": False,

            "message": "ThingSpeak Channel ID or Read API Key is not configured. Please visit Settings.",

            "device_status": {

                "esp32": "WAITING CONFIG",

                "data_link": "DISCONNECTED",

                "thingspeak": "NOT CONFIGURED",

                "is_online": False,

                "age_seconds": None,

                "message": "Please configure Channel ID and Read API Key"

            },

            "metrics": {

                "voltage": None,

                "current": None,

                "power": None,

                "energy": None,

                "bill_amount": None,

                "calculated_bill": None,

                "unit_labels": {

                    "voltage": "V",

                    "current": "A",

                    "power": "W",

                    "energy": "kWh",

                    "bill_amount": "₹"

                }

            },

            "insights": {

                "usage_status": "Unknown",

                "usage_badge": "neutral",

                "usage_desc": "Configure ThingSpeak credentials in Settings",

                "efficiency": "Unknown",

                "efficiency_badge": "neutral",

                "efficiency_desc": "No data available",

                "trend": "Stable",

                "trend_direction": "flat",

                "alerts": [{"type": "info", "title": "Setup Required", "message": "Set your ThingSpeak Channel ID and Read API Key in Settings to start monitoring."}]

            },

            "last_update": None,

            "last_update_formatted": None

        })

    url = f"https://api.thingspeak.com/channels/{channel_id}/feeds.json"

    params = {

        "api_key": read_api_key,

        "results": 5  # Fetch last 5 feeds for trend calculation

    }

    try:

        response = requests.get(url, params=params, timeout=8)

        if response.status_code == 404 or response.status_code == 400:

            return jsonify({

                "status": "error",

                "is_configured": True,

                "error_type": "invalid_credentials",

                "message": "ThingSpeak Channel not found or invalid Read API Key.",

                "device_status": {

                    "esp32": "OFFLINE",

                    "data_link": "DISCONNECTED",

                    "thingspeak": "AUTHENTICATION ERROR",

                    "is_online": False,

                    "age_seconds": None,

                    "message": "Check Channel ID & Read API Key"

                },

                "metrics": None

            }), 400

        response.raise_for_status()

        data = response.json()

        feeds = data.get("feeds", [])

        if not feeds:

            # Channel exists but has zero feeds

            return jsonify({

                "status": "empty",

                "is_configured": True,

                "message": "ThingSpeak channel has no feeds yet. Waiting for ESP32 data...",

                "device_status": {

                    "esp32": "WAITING DATA",

                    "data_link": "DISCONNECTED",

                    "thingspeak": "NO FEEDS",

                    "is_online": False,

                    "age_seconds": None,

                    "message": "Waiting for first ESP32 feed"

                },

                "metrics": {

                    "voltage": None,

                    "current": None,

                    "power": None,

                    "energy": None,

                    "bill_amount": None,

                    "calculated_bill": None

                },

                "last_update": None

            })

        latest_feed = feeds[-1]

        raw_created_at = latest_feed.get("created_at")

        feed_dt = parse_iso_time(raw_created_at)

        # Parse metrics safely

        voltage = parse_float_safe(latest_feed.get("field1"))

        current = parse_float_safe(latest_feed.get("field2"))

        power = parse_float_safe(latest_feed.get("field3"))

        energy = parse_float_safe(latest_feed.get("field4"))

        # Field 7 is Bill Amount (computed by ESP32 firmware using TNEB slabs)

        field7_bill = parse_float_safe(latest_feed.get("field7"))

        # TNEB Tariff Calculation (matching ESP32 firmware formula)

        calc_bill = calculate_tneb_bill(energy) if energy is not None else None

        final_bill = field7_bill if field7_bill is not None else calc_bill

        tneb_breakdown = get_tneb_breakdown(energy) if energy is not None else get_tneb_breakdown(0)

        # Calculate dynamic device & data link status

        device_status = calculate_status(feed_dt, timeout_sec)

        # Calculate insights & alerts

        insights = calculate_insights(voltage, current, power, energy, feeds)

        ml_prediction = process_energy_anomaly(
            voltage=voltage,
            current=current,
            power=power,
            entry_id=latest_feed.get("entry_id")
        )

        # Format timestamp in Asia/Kolkata (IST)

        feed_dt_ist = feed_dt.astimezone(IST) if feed_dt else None

        formatted_time = feed_dt_ist.strftime("%I:%M:%S %p") if feed_dt_ist else None

        formatted_date = feed_dt_ist.strftime("%d %b %Y, %I:%M:%S %p") if feed_dt_ist else None

        # Update cache

        last_valid_state["data"] = latest_feed

        last_valid_state["last_successful_timestamp"] = raw_created_at

        last_valid_state["last_successful_time_str"] = formatted_time

        last_valid_state["is_configured"] = True

        return jsonify({

            "status": "success",

            "is_configured": True,

            "channel_info": {

                "id": data.get("channel", {}).get("id"),

                "name": data.get("channel", {}).get("name", "EnergySense Channel"),

            },

            "device_status": device_status,

            "metrics": {

                "voltage": voltage,

                "current": current,

                "power": power,

                "energy": energy,

                "bill_amount": final_bill,

                "field7_bill": field7_bill,

                "calculated_bill": calc_bill,

                "tneb_breakdown": tneb_breakdown,

                "unit_labels": {

                    "voltage": "V",

                    "current": "A",

                    "power": "W",

                    "energy": "kWh",

                    "bill_amount": "₹"

                }

            },

            "insights": insights,
            "ml_prediction": ml_prediction,

            "entry_id": latest_feed.get("entry_id"),

            "last_update": raw_created_at,

            "last_update_formatted": formatted_time,

            "last_update_full": formatted_date

        })

    except requests.exceptions.RequestException as e:

        # Non-intrusive error fallback: keep previous timestamp visible if available

        prev_time = last_valid_state["last_successful_time_str"]

        return jsonify({

            "status": "error",

            "is_configured": True,

            "error_type": "network_error",

            "message": "Unable to fetch latest data from ThingSpeak Cloud.",

            "device_status": {

                "esp32": "OFFLINE",

                "data_link": "DISCONNECTED",

                "thingspeak": "CONNECTION ERROR",

                "is_online": False,

                "age_seconds": None,

                "message": "ThingSpeak API Request Failed"

            },

            "last_successful_update": prev_time,

            "insights": {

                "alerts": [{"type": "danger", "title": "ThingSpeak Connection Error", "message": "Failed to reach ThingSpeak Cloud API. Check network or API rate limits."}]

            }

        }), 200  # Return 200 with error payload so frontend handles gracefully without crashing

@app.route("/api/energy/history", methods=["GET"])

def api_energy_history():

    """

    Fetches historical feeds from ThingSpeak for charts and analytics.

    Accepts query param 'results' (e.g. 10, 20, 50, 100).

    """

    settings = Config.get_settings()

    channel_id = settings["channel_id"]

    read_api_key = settings["read_api_key"]

    if not channel_id or not read_api_key:

        return jsonify({

            "status": "unconfigured",

            "feeds": [],

            "message": "ThingSpeak not configured."

        })

    results_count = request.args.get("results", default=20, type=int)

    if results_count not in (10, 20, 50, 100, 200):

        results_count = 20

    url = f"https://api.thingspeak.com/channels/{channel_id}/feeds.json"

    params = {

        "api_key": read_api_key,

        "results": results_count

    }

    try:

        response = requests.get(url, params=params, timeout=10)

        response.raise_for_status()

        data = response.json()

        raw_feeds = data.get("feeds", [])

        processed_feeds = []

        for f in raw_feeds:

            raw_ts = f.get("created_at")

            ts = parse_iso_time(raw_ts)

            ts_ist = ts.astimezone(IST) if ts else None

            formatted_time = ts_ist.strftime("%d %b, %I:%M %p") if ts_ist else ""

            formatted_date = ts_ist.strftime("%d %b %Y, %I:%M:%S %p") if ts_ist else ""

            v = parse_float_safe(f.get("field1"))

            i = parse_float_safe(f.get("field2"))

            p = parse_float_safe(f.get("field3"))

            e = parse_float_safe(f.get("field4"))

            bill = parse_float_safe(f.get("field7"))

            if bill is None and e is not None:

                bill = calculate_tneb_bill(e)

            processed_feeds.append({

                "entry_id": f.get("entry_id"),

                "created_at": raw_ts,

                "time_label": formatted_time,

                "date_label": formatted_date,

                "voltage": v,

                "current": i,

                "power": p,

                "energy": e,

                "bill_amount": bill

            })

        return jsonify({

            "status": "success",

            "count": len(processed_feeds),

            "results_requested": results_count,

            "feeds": processed_feeds

        })

    except requests.exceptions.RequestException as e:

        return jsonify({

            "status": "error",

            "message": f"Failed to fetch history: {str(e)}",

            "feeds": []

        }), 200

if __name__ == "__main__":

    port = int(os.environ.get("PORT", 5000))

    print("=" * 60)

    print("⚡ EnergySense - IoT Based Smart Energy Monitoring System")

    print(f"🚀 Server running on http://127.0.0.1:{port}")

    print("=" * 60)

    app.run(host="0.0.0.0", port=port, debug=True)
