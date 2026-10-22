
import os
import joblib
import pandas as pd

from pathlib import Path
from sklearn.ensemble import IsolationForest
from config import Config

MODEL_PATH = Path(__file__).resolve().parent / "energy_model.pkl"

FEATURES = ["voltage", "current", "power"]


def get_historical_readings():
    """Fetch historical sensor data from ThingSpeak."""
    import requests

    settings = Config.get_settings()
    channel_id = settings["channel_id"]
    api_key = settings["read_api_key"]

    if not channel_id or not api_key:
        raise ValueError("ThingSpeak is not configured.")

    url = (
        f"https://api.thingspeak.com/channels/"
        f"{channel_id}/feeds.json"
    )

    response = requests.get(
        url,
        params={"api_key": api_key, "results": 200},
        timeout=15
    )
    response.raise_for_status()

    feeds = response.json().get("feeds", [])
    rows = []

    for feed in feeds:
        rows.append({
            "voltage": feed.get("field1"),
            "current": feed.get("field2"),
            "power": feed.get("field3")
        })

    df = pd.DataFrame(rows)

    if df.empty:
        raise ValueError("No historical readings found.")

    for column in FEATURES:
        df[column] = pd.to_numeric(
            df[column], errors="coerce"
        )

    df = df.dropna(subset=FEATURES)

    # Remove invalid negative sensor values.
    df = df[(df[FEATURES] >= 0).all(axis=1)]

    if len(df) < 30:
        raise ValueError(
            f"Only {len(df)} valid readings. "
            "Collect at least 30 before training."
        )

    return df[FEATURES]


def train_model():
    """Train the model using historical ThingSpeak data."""
    df = get_historical_readings()

    model = IsolationForest(
        n_estimators=100,
        contamination=0.05,
        random_state=42
    )

    model.fit(df[FEATURES])
    joblib.dump(model, MODEL_PATH)

    return len(df)


def predict_reading(voltage, current, power):
    """Return NORMAL or ABNORMAL for a new reading."""
    if not MODEL_PATH.exists():
        raise RuntimeError(
            "Model not trained. Run train_model.py first."
        )

    model = joblib.load(MODEL_PATH)

    sample = pd.DataFrame([{
        "voltage": voltage,
        "current": current,
        "power": power
    }], columns=FEATURES)

    if sample.isna().any().any():
        raise ValueError("Missing sensor values.")

    if (sample[FEATURES] < 0).any().any():
        raise ValueError("Invalid negative sensor values.")

    prediction = int(model.predict(sample)[0])
    score = float(model.decision_function(sample)[0])

    return {
        "status": "ABNORMAL" if prediction == -1 else "NORMAL",
        "score": round(score, 4)
    }
