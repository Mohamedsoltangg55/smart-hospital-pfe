import axios from 'axios';

// ✅ Centralized API client with environment-based URL
const rawApiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const API_URL = typeof window !== 'undefined'
  ? rawApiUrl.replace('http://backend:8000', 'http://localhost:8000')
  : rawApiUrl;

const client = axios.create({
  baseURL: API_URL,
});

// ✅ Interceptor to add JWT token to all requests
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ✅ Interceptor to handle auth errors globally
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Clear token and redirect to login on auth failure
      localStorage.removeItem('token');
      localStorage.removeItem('role');
      localStorage.removeItem('userId');
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

export default client;
