import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
import joblib

# 1. Create a "Fake" Dataset to teach the AI
# (Age, Diabetes?, Hypertension?, Smoker? -> RISK LEVEL)
data = {
    'age': [25, 30, 45, 50, 60, 70, 20, 55, 80, 40],
    'diabetes': [0, 0, 1, 0, 1, 1, 0, 1, 1, 0],       # 0=No, 1=Yes
    'hypertension': [0, 0, 0, 1, 1, 1, 0, 1, 1, 0],
    'smoker': [0, 1, 0, 1, 1, 0, 0, 0, 0, 1],
    'risk_label': [0, 1, 2, 2, 3, 3, 0, 2, 3, 1]      # 0=Low, 1=Moderate, 2=High, 3=Critical
}

df = pd.DataFrame(data)

# 2. Split Data (Features vs Result)
X = df[['age', 'diabetes', 'hypertension', 'smoker']]
y = df['risk_label']

# 3. Train the Brain (Random Forest)
model = RandomForestClassifier(n_estimators=100)
model.fit(X, y)

# 4. Save the Brain to a file
joblib.dump(model, 'heart_disease_model.pkl')
print("Model trained and saved as 'heart_disease_model.pkl'")