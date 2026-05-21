import React, { useState, useEffect } from 'react';
import { Card, Table, Tag, Button, Modal, Form, Input, InputNumber, Select, message, Space, Typography } from 'antd';
import { AppstoreAddOutlined, MedicineBoxOutlined, PlusOutlined, MinusOutlined } from '@ant-design/icons';
import client from '../api/client';

const { Title } = Typography;

const InventoryManagement = () => {
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [form] = Form.useForm();

  const fetchInventory = async () => {
    setLoading(true);
    try {
      const res = await client.get('/inventory/');
      setInventory(res.data);
    } catch (error) {
      message.error("Failed to load inventory");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchInventory(); }, []);

  const handleCreateItem = async (values) => {
    try {
      await client.post('/inventory/', values);
      message.success("Item added to catalog");
      setIsModalVisible(false);
      form.resetFields();
      fetchInventory();
    } catch (error) {
      message.error("Failed to add item");
    }
  };

  const updateStock = async (id, change) => {
    try {
      await client.patch(`/inventory/${id}`, {
        quantity_change: change,
        user: localStorage.getItem('username')
      });
      message.success("Stock updated!");
      fetchInventory();
    } catch (error) {
      message.error("Failed to update stock");
    }
  };

  const columns = [
    { title: 'Item Name', dataIndex: 'item_name', render: (text) => <b>{text}</b> },
    { 
      title: 'Category', 
      dataIndex: 'category',
      render: (cat) => <Tag color={cat === 'Medicine' ? 'geekblue' : (cat === 'Equipment' ? 'purple' : 'default')}>{cat}</Tag>
    },
    { 
      title: 'Current Stock', 
      key: 'stock',
      render: (_, record) => {
        const isLow = record.quantity <= record.reorder_level;
        return (
          <Space>
            <span style={{ fontSize: '16px', fontWeight: 'bold', color: isLow ? '#cf1322' : '#389e0d' }}>
              {record.quantity} {record.unit}
            </span>
            {isLow && <Tag color="red">LOW STOCK</Tag>}
          </Space>
        );
      }
    },
    {
      title: 'Quick Actions',
      key: 'actions',
      render: (_, record) => (
        <Space>
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => updateStock(record.id, 10)}>+10</Button>
          <Button size="small" danger icon={<MinusOutlined />} onClick={() => updateStock(record.id, -1)}>-1</Button>
        </Space>
      )
    }
  ];

  return (
    <div style={{ animation: 'fadeIn 0.5s' }}>
      <Card 
        title={
          <Space>
            <MedicineBoxOutlined style={{ color: '#1890ff', fontSize: '24px' }} />
            <Title level={3} style={{ margin: 0 }}>Pharmacy & Supply Inventory</Title>
          </Space>
        }
        extra={
          <Button type="primary" icon={<AppstoreAddOutlined />} onClick={() => setIsModalVisible(true)}>
            Add New Item
          </Button>
        }
        style={{ borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
      >
        <Table columns={columns} dataSource={inventory} rowKey="id" loading={loading} />
      </Card>

      <Modal title="Add to Master Catalog" open={isModalVisible} onCancel={() => setIsModalVisible(false)} footer={null}>
        <Form form={form} layout="vertical" onFinish={handleCreateItem}>
          <Form.Item name="item_name" label="Item Name" rules={[{ required: true }]}>
            <Input placeholder="e.g., Amoxicillin 500mg" />
          </Form.Item>
          <Form.Item name="category" label="Category" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="Medicine">Medicine</Select.Option>
              <Select.Option value="Equipment">Surgical Equipment</Select.Option>
              <Select.Option value="Supplies">General Supplies</Select.Option>
            </Select>
          </Form.Item>
          <Space>
            <Form.Item name="quantity" label="Starting Quantity" rules={[{ required: true }]}>
              <InputNumber min={0} />
            </Form.Item>
            <Form.Item name="unit" label="Unit Type" rules={[{ required: true }]}>
              <Input placeholder="boxes, units, etc." />
            </Form.Item>
            <Form.Item name="reorder_level" label="Low Stock Warning Level" rules={[{ required: true }]}>
              <InputNumber min={1} />
            </Form.Item>
          </Space>
          <Button type="primary" htmlType="submit" block size="large">Save to Catalog</Button>
        </Form>
      </Modal>
    </div>
  );
};

export default InventoryManagement;