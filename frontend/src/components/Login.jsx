import React, { useState } from 'react';
import { Form, Input, Button, Card, Typography, message } from 'antd';
import { UserOutlined, LockOutlined, MedicineBoxOutlined } from '@ant-design/icons';
import client from '../api/client';  // ✅ Use centralized API client

const { Title } = Typography;

const Login = ({ onLogin }) => {
  const [loading, setLoading] = useState(false);

  const handleLogin = async (values) => {
    setLoading(true);
    try {
      const res = await client.post('/token', 
        new URLSearchParams({
          username: values.username,
          password: values.password
        })
      );

      // ✅ Store JWT token (not username)
      localStorage.setItem('token', res.data.access_token);
      localStorage.setItem('role', res.data.role);
      localStorage.setItem('userId', res.data.userId);
      localStorage.setItem('username', values.username);

      // ✅ Pass role and userId to App
      onLogin(res.data.role, res.data.userId);
      
      const prefix = res.data.role === 'doctor' ? 'Dr. ' : '';
      message.success(`Welcome ${prefix}${values.username}`);
      
    } catch (error) {
      message.error(error.response?.data?.detail || "Login failed. Check credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#f0f2f5' }}>
      <Card style={{ width: 400, boxShadow: '0 8px 24px rgba(0,0,0,0.08)', borderRadius: '12px' }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <MedicineBoxOutlined style={{ fontSize: 48, color: '#1890ff' }} />
          <Title level={3} style={{ marginTop: '10px' }}>Smart Hospital Portal</Title>
        </div>

        <Form layout="vertical" onFinish={handleLogin}>
          <Form.Item name="username" rules={[{ required: true, message: 'Please input your username!' }]}>
            <Input prefix={<UserOutlined />} placeholder="Username (e.g., admin)" size="large" />
          </Form.Item>

          <Form.Item name="password" rules={[{ required: true, message: 'Please input your password!' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="Password" size="large" />
          </Form.Item>

          <Button type="primary" htmlType="submit" size="large" block loading={loading}>
            Sign In
          </Button>
        </Form>
      </Card>
    </div>
  );
};

export default Login;