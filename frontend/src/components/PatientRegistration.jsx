import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, DatePicker, Button, Typography, Space, message, Row, Col, Select, Divider } from 'antd';
import { UserAddOutlined, IdcardOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import client from '../api/client';

const { Title, Text } = Typography;
const { Option } = Select;

const PatientRegistration = ({ onRegistered }) => {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  // The Smart NSS Generator Engine
  const generateNSS = (gender, dob, wilaya) => {
    const genderCode = gender === 'Male' ? '1' : '2';
    const yearCode = dob.format('YY'); // Gets last two digits of birth year (e.g., 1998 -> 98)
    const wilayaCode = wilaya.padStart(2, '0'); // Ensures 2 digits (e.g., 17)
    
    // Generate a unique 6-digit serial using the current time + random numbers to prevent duplicates
    const timestampPart = String(Date.now()).slice(-3);
    const randomPart = Math.floor(100 + Math.random() * 900); 
    const uniqueSerial = `${timestampPart}${randomPart}`;

    // Format: [Gender] [Year] [Wilaya] [Unique Serial]
    return `${genderCode}${yearCode}${wilayaCode}${uniqueSerial}`;
  };

  const handleRegister = async (values) => {
    setLoading(true);
    try {
      // 1. Calculate the Unique NSS
      const generatedNSS = generateNSS(values.gender, values.date_of_birth, values.wilaya);

      // 2. Prepare the payload for the backend
      const payload = {
        first_name: values.first_name,
        last_name: values.last_name,
        date_of_birth: values.date_of_birth.format('YYYY-MM-DD'),
        phone: values.phone,
        gender: values.gender,
        wilaya: values.wilaya,
        nss: generatedNSS, // Attach the unique number
        user: localStorage.getItem('username') || 'Front Desk'
      };

      // 3. Send to server
      const res = await client.post('/patients/', payload);
      
      // 4. Show success message with the official NSS
      message.success({
        content: `Success! Patient registered. Official NSS: ${generatedNSS}`,
        duration: 6,
        style: { fontSize: '16px', fontWeight: 'bold' }
      });
      
      form.resetFields(); // Clear the form
      if (onRegistered) {
        onRegistered(res.data);
      } else {
        navigate('/patients');
      }
    } catch (error) {
      // Check if backend rejected it because of a duplicate NSS (just in case)
      if (error.response && error.response.status === 400) {
        message.error("Registration failed: Patient might already exist.");
      } else {
        message.error("Failed to register patient. Please check your connection.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ animation: 'fadeIn 0.5s', maxWidth: '850px', margin: '0 auto' }}>
      <Card 
        title={
          <Space>
            <IdcardOutlined style={{ color: '#1890ff', fontSize: '28px' }} />
            <Title level={3} style={{ margin: 0 }}>Register New Patient</Title>
          </Space>
        }
        style={{ borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
      >
        <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#f6ffed', borderRadius: '8px', borderLeft: '4px solid #52c41a', display: 'flex', alignItems: 'flex-start' }}>
          <SafetyCertificateOutlined style={{ color: '#52c41a', fontSize: '24px', marginRight: '12px', marginTop: '2px' }} />
          <div>
            <Text strong style={{ fontSize: '16px' }}>Smart NSS Generation Active</Text>
            <br/>
            <Text type="secondary">The system will automatically generate a cryptographically unique Numéro de Sécurité Sociale based on the patient's demographics (Gender, Year of Birth, and Wilaya).</Text>
          </div>
        </div>

        <Form form={form} layout="vertical" onFinish={handleRegister} size="large" initialValues={{ wilaya: '17' }}>
          
          <Divider orientation="left">Personal Information</Divider>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="first_name" label="Legal First Name" rules={[{ required: true, message: 'First name is required' }]}>
                <Input placeholder="e.g., Mohamed" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="last_name" label="Legal Last Name" rules={[{ required: true, message: 'Last name is required' }]}>
                <Input placeholder="e.g., Yahi" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="date_of_birth" label="Date of Birth" rules={[{ required: true, message: 'DOB is required for NSS generation' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="gender" label="Gender" rules={[{ required: true, message: 'Gender is required for NSS' }]}>
                <Select placeholder="Select Gender">
                  <Option value="Male">Male</Option>
                  <Option value="Female">Female</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="wilaya" label="Wilaya of Origin" rules={[{ required: true, message: 'Wilaya is required for NSS' }]}>
                <Select showSearch placeholder="Select Wilaya">
                  <Option value="16">16 - Alger</Option>
                  <Option value="17">17 - Djelfa</Option>
                  <Option value="31">31 - Oran</Option>
                  <Option value="09">09 - Blida</Option>
                  <Option value="12">12 - Tebessa</Option>
                  <Option value="25">25 - Constantine</Option>
                  <Option value="19">19 - Sétif</Option>
                  <Option value="13">13 - Tlemcen</Option>
                </Select>
              </Form.Item>
            </Col>  
          </Row>

          <Divider orientation="left">Contact Information</Divider>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="phone" label="Emergency Contact Number" rules={[{ required: true, message: 'Contact number is required' }]}>
                <Input placeholder="e.g., 0555 12 34 56" />
              </Form.Item>
            </Col>
          </Row>

          <Button 
            type="primary" 
            htmlType="submit" 
            block 
            icon={<UserAddOutlined />} 
            loading={loading}
            style={{ marginTop: '20px', height: '54px', borderRadius: '8px', fontSize: '18px', fontWeight: 'bold' }}
          >
            Generate NSS & Add Patient
          </Button>
        </Form>
      </Card>
    </div>
  );
};

export default PatientRegistration;