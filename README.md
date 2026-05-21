# 🏥 Smart Hospital PFE System

## 📋 Project Overview
A microservices-based Hospital Management System designed to modernize healthcare administration. This project leverages **AI for disease prediction** and **Blockchain for record integrity**, built on a scalable containerized architecture.

## 🏗 Architecture
The system follows a 3-Tier Microservices architecture:
* **Frontend:** React.js + Ant Design (Port 5173)
* **Backend:** FastAPI (Python) (Port 8000)
* **AI Engine:** Scikit-Learn + FastAPI (Port 8001)
* **Database:** PostgreSQL (Port 5432)

## 🚀 Getting Started

### Prerequisites
* Docker & Docker Compose

### Installation
1.  Clone the repository:
    ```bash
    git clone [https://github.com/YOUR_USERNAME/smart-hospital-pfe.git](https://github.com/YOUR_USERNAME/smart-hospital-pfe.git)
    ```
2.  Start the services:
    ```bash
    docker-compose up -d --build
    ```
3.  Access the application:
    * Web Interface: http://localhost:5173
    * API Documentation: http://localhost:8000/docs

## 🛡 Security Features
* JWT Authentication
* Password Hashing (Bcrypt)
* Role-Based Access Control (RBAC)

## 🤖 AI Features
* Heart Disease Prediction Model
* Drug Interaction Checker