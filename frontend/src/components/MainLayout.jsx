import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Typography, Avatar, Space, Tag, Badge } from 'antd'; 
import { 
  UserOutlined, UserAddOutlined, HourglassOutlined, 
  MedicineBoxOutlined, LogoutOutlined, SafetyCertificateOutlined,
  SolutionOutlined, TeamOutlined, SettingOutlined, DollarOutlined, DesktopOutlined,ExperimentOutlined
} from '@ant-design/icons';

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

const MainLayout = ({ children, onLogout, role }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname.substring(1) || 'dashboard';

  const adminMenuItems = [
    { key: 'dashboard', icon: <HourglassOutlined />, label: 'Dashboard Overview' },
    { key: 'triage', icon: <TeamOutlined />, label: 'Réception & Triage' }, 
    { key: 'PatientRegistration', icon: <UserAddOutlined />, label: 'Register Patient' },
    { key: 'patients', icon: <SolutionOutlined/>, label: 'Patient Directory' },
    { key: 'hospitalisation_beds', icon: <MedicineBoxOutlined />, label: 'Hospitalisation Beds' },
    { key: 'laboratory', icon: <ExperimentOutlined />, label: 'Espace Laboratoire' },
    { key: 'inventory', icon: <MedicineBoxOutlined/>, label: 'Pharmacy Inventory' },
    { key: 'cashier', icon: <DollarOutlined />, label: 'Caisse & Facturation' },
    { key: 'users', icon: <UserOutlined />, label: 'System Admin (Users)' },
    { key: 'audit_logs', icon: <SafetyCertificateOutlined />, label: 'Security Audit Logs' },
    { key: 'admin_settings', icon: <SettingOutlined />, label: 'Admin Settings' },
    
    
  ];

  const receptionMenuItems = [
    { key: 'triage', icon: <TeamOutlined />, label: 'Réception & Triage' }, 
    { key: 'PatientRegistration', icon: <UserAddOutlined />, label: 'Register Patient' },
    { key: 'patients', icon: <SolutionOutlined />, label: 'Annuaire Patients' },
    { key: 'hospitalisation_beds', icon: <MedicineBoxOutlined />, label: 'Hospitalisation Beds' },
    { key: 'cashier', icon: <DollarOutlined />, label: 'Caisse & Facturation' },
  ];

  const doctorMenuItems = [
    { key: 'doctor_queues', icon: <MedicineBoxOutlined />, label: 'My Patient Queue' },
    { key: 'patients', icon: <SolutionOutlined />, label: 'Patient Directory' },
  ];

  const nurseMenuItems = [
    { key: 'nurse_workspace', icon: <MedicineBoxOutlined />, label: 'Soins Infirmiers' },
    { key: 'hospitalisation_beds', icon: <MedicineBoxOutlined />, label: 'Bed Map' },
    { key: 'patients', icon: <SolutionOutlined />, label: 'Annuaire Patients' },
  ];

  const labMenuItems = [
  { key: 'laboratory', icon: <ExperimentOutlined />, label: 'Espace Laboratoire' },
];

  const getMenuItems = () => {
    const currentRole = role ? role.toLowerCase() : '';
    if (currentRole === 'admin') return adminMenuItems;
    if (currentRole === 'doctor') return doctorMenuItems;
    if (currentRole === 'nurse') return nurseMenuItems; 
    if (currentRole === 'lab_tech') return labMenuItems;
    if (['staff', 'reception'].includes(currentRole)) return receptionMenuItems; 
    return [];
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="dark" width={260} breakpoint="lg" collapsedWidth="0">
        <div style={{ padding: '24px', textAlign: 'center', background: '#001529' }}>
          <Title level={4} style={{ color: 'white', margin: 0 }}>🏥 Smart Hospital</Title>
          <Tag color="cyan" style={{ marginTop: '8px' }}>{role?.toUpperCase()}</Tag>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[currentPath]}
          items={getMenuItems()}
          onClick={(e) => navigate(`/${e.key}`)}
        />
        <div style={{ position: 'absolute', bottom: 20, width: '100%', padding: '0 20px' }}>
          <Button 
            type="primary" 
            ghost 
            block 
            icon={<DesktopOutlined />} 
            onClick={() => window.open('?view=tv', '_blank')}
          >
            Launch TV Display
          </Button>
        </div>
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <Space size="middle">
             <Text strong>{localStorage.getItem('username')}</Text>
             <Avatar icon={<UserOutlined />} />
             <Button type="primary" danger icon={<LogoutOutlined />} onClick={onLogout}>Logout</Button>
          </Space>
        </Header>
        <Content style={{ margin: '24px', padding: 24, background: '#fff', borderRadius: '12px', overflow: 'initial' }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
};

export default MainLayout;