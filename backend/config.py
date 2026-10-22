"""
Configuration manager for EnergySense IoT Dashboard.
Handles environment variables, default settings, and runtime setting updates.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Base directory paths
BASE_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BASE_DIR / ".env"

# Load environment variables
load_dotenv(dotenv_path=ENV_FILE, override=True)


class Config:
    @staticmethod
    def get_settings():
        """Retrieve all configuration settings from environment."""
        load_dotenv(dotenv_path=ENV_FILE, override=True)
        return {
            "channel_id": os.getenv("THINGSPEAK_CHANNEL_ID", "").strip(),
            "read_api_key": os.getenv("THINGSPEAK_READ_API_KEY", "").strip(),
            "data_timeout": int(os.getenv("DATA_TIMEOUT", "60")),
            "refresh_interval": int(os.getenv("REFRESH_INTERVAL", "15")),
        }

    @staticmethod
    def get_masked_settings():
        """Retrieve settings with masked Read API Key for safe frontend display."""
        settings = Config.get_settings()
        raw_key = settings["read_api_key"]
        if raw_key and len(raw_key) > 4:
            masked_key = "*" * (len(raw_key) - 4) + raw_key[-4:]
        elif raw_key:
            masked_key = "*" * len(raw_key)
        else:
            masked_key = ""

        return {
            "channel_id": settings["channel_id"],
            "read_api_key": masked_key,
            "has_api_key": bool(raw_key),
            "data_timeout": settings["data_timeout"],
            "refresh_interval": settings["refresh_interval"],
        }

    @staticmethod
    def update_settings(channel_id=None, read_api_key=None, data_timeout=None, refresh_interval=None):
        """Update settings and persist them to .env file."""
        current = Config.get_settings()

        new_channel_id = channel_id.strip() if channel_id is not None else current["channel_id"]
        
        # Only update key if a new non-masked key is provided
        if read_api_key is not None and not read_api_key.startswith("*") and read_api_key.strip():
            new_read_key = read_api_key.strip()
        else:
            new_read_key = current["read_api_key"]

        new_timeout = int(data_timeout) if data_timeout is not None else current["data_timeout"]
        new_refresh = int(refresh_interval) if refresh_interval is not None else current["refresh_interval"]

        # Ensure minimum safe refresh interval (ThingSpeak free limit is 15s)
        if new_refresh < 5:
            new_refresh = 5
        if new_timeout < 10:
            new_timeout = 10

        content = f"""# ==============================================================================
# EnergySense - ThingSpeak Configuration & Settings (Auto-updated)
# ==============================================================================
THINGSPEAK_CHANNEL_ID={new_channel_id}
THINGSPEAK_READ_API_KEY={new_read_key}

# Data Freshness Timeout (in seconds)
DATA_TIMEOUT={new_timeout}

# Dashboard Polling Interval (in seconds)
REFRESH_INTERVAL={new_refresh}
"""
        with open(ENV_FILE, "w", encoding="utf-8") as f:
            f.write(content)

        # Update current environment
        os.environ["THINGSPEAK_CHANNEL_ID"] = new_channel_id
        os.environ["THINGSPEAK_READ_API_KEY"] = new_read_key
        os.environ["DATA_TIMEOUT"] = str(new_timeout)
        os.environ["REFRESH_INTERVAL"] = str(new_refresh)

        return Config.get_masked_settings()
