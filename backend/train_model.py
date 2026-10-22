
from anomaly_service import train_model

try:
    count = train_model()
    print(f"ML model trained successfully using {count} readings.")
except Exception as error:
    print(f"Training failed: {error}")
