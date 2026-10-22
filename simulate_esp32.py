"""
EnergySense - ESP32 & PZEM-004T Hardware Simulator (Optional Testing Tool)

This script simulates an ESP32 reading data from a PZEM-004T sensor and uploading
feeds to your ThingSpeak channel every 15 seconds.

Usage:
  python simulate_esp32.py --write_key YOUR_WRITE_API_KEY [--channel_id YOUR_CHANNEL_ID]
"""

import sys
import time
import random
import argparse
import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

def calculate_bill(units):
    """
    TNEB Domestic Bill Calculation (Exact match to ESP32 firmware):
    0 - 200       = FREE
    201 - 400     = Rs. 4.70 / Unit
    401 - 500     = Rs. 6.30 / Unit
    Above 500     = Rs. 8.40 / Unit
    """
    if units <= 200:
        return 0.0
    elif units <= 400:
        return round((units - 200) * 4.70, 2)
    elif units <= 500:
        return round((200 * 4.70) + ((units - 400) * 6.30), 2)
    else:
        return round((300 * 4.70) + (100 * 6.30) + ((units - 500) * 8.40), 2)


def run_simulation(write_api_key, interval=15):
    print("=" * 65)
    print("⚡ EnergySense - ESP32 & PZEM-004T Hardware Simulator")
    print(f"📡 Uploading simulated sensor packets every {interval}s to ThingSpeak")
    print("👉 Press Ctrl+C at any time to simulate 'ESP32 OFFLINE' condition")
    print("=" * 65)

    base_voltage = 228.0
    base_energy = 0.50
    packet_count = 0

    while True:
        packet_count += 1
        # Realistic PZEM-004T fluctuation simulation
        voltage = round(base_voltage + random.uniform(-4.5, 4.5), 1)
        current = round(random.uniform(0.8, 3.2), 2)
        pf = round(random.uniform(0.88, 0.98), 2)
        power = round(voltage * current * pf, 1)
        
        # Increment cumulative energy
        kwh_increment = (power * (interval / 3600.0)) / 1000.0
        base_energy += kwh_increment
        energy = round(base_energy, 4)
        
        frequency = round(50.0 + random.uniform(-0.15, 0.15), 1)
        bill = calculate_bill(energy)

        payload = {
            "api_key": write_api_key,
            "field1": voltage,     # Voltage (V)
            "field2": current,     # Current (A)
            "field3": power,       # Power (W)
            "field4": energy,      # Energy (kWh)
            "field5": frequency,   # Frequency (Hz)
            "field6": pf,          # Power Factor
            "field7": bill         # Bill Amount (₹)
        }

        try:
            url = "https://api.thingspeak.com/update"
            resp = requests.post(url, data=payload, timeout=8)
            if resp.status_code == 200 and resp.text != "0":
                entry_id = resp.text.strip()
                print(f"[{time.strftime('%I:%M:%S %p')}] Packet #{packet_count} Uploaded -> Entry #{entry_id} | V={voltage}V | I={current}A | P={power}W | E={energy}kWh | PF={pf} | Bill=₹{bill}")
            elif resp.text == "0":
                print(f"[{time.strftime('%I:%M:%S %p')}] ⚠️ ThingSpeak Rate Limit (15s minimum spacing required)")
            else:
                print(f"[{time.strftime('%I:%M:%S %p')}] ❌ HTTP {resp.status_code}: {resp.text}")
        except Exception as e:
            print(f"[{time.strftime('%I:%M:%S %p')}] ❌ Request failed: {e}")

        time.sleep(interval)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Simulate ESP32 PZEM-004T ThingSpeak uploads.")
    parser.add_argument("--write_key", required=True, help="Your ThingSpeak WRITE API Key")
    parser.add_argument("--interval", type=int, default=15, help="Upload interval in seconds (default: 15)")
    args = parser.parse_args()

    try:
        run_simulation(args.write_key, args.interval)
    except KeyboardInterrupt:
        print("\n\n🛑 Simulator stopped. ESP32 is now OFFLINE. Check dashboard status transition!")
