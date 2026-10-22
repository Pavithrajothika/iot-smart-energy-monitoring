
import os
import requests
from pathlib import Path
from dotenv import load_dotenv

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(ENV_FILE, override=True)


def send_telegram_alert(message):
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.getenv("TELEGRAM_CHAT_ID", "").strip()

    if not token or not chat_id:
        print("ERROR: Bot token or chat ID missing in .env")
        return False

    url = f"https://api.telegram.org/bot{token}/sendMessage"

    try:
        response = requests.post(
            url,
            json={"chat_id": chat_id, "text": message},
            timeout=15
        )
        response.raise_for_status()
        result = response.json()

        if result.get("ok"):
            print("SUCCESS: Telegram message sent!")
            return True

        print("Telegram API error:", result.get("description"))
        return False

    except requests.RequestException as error:
        print("Telegram request failed:", error)
        return False


if __name__ == "__main__":
    send_telegram_alert(
        "EnergySense Test Alert\n"
        "Telegram notification is working!"
    )
