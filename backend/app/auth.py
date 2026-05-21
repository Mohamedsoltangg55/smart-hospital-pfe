import os
from datetime import datetime, timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext
from dotenv import load_dotenv

load_dotenv()  # ✅ Load environment variables from .env file

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change_this_in_production_immediately")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

pwd_context = CryptContext(schemes=["pbkdf2_sha256", "bcrypt"], deprecated="auto")

def verify_password(plain_password, hashed_password):
    # ✅ Try bcrypt first (for properly hashed passwords)
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        # ✅ Fallback: direct comparison (for plaintext passwords in development)
        return plain_password == hashed_password

def get_password_hash(password):
    try:
        return pwd_context.hash(password)
    except Exception:
        # Development fallback if the local hashing backend is unavailable.
        return password

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)