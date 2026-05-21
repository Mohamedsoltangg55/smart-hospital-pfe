import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './components/MainLayout';
import Login from './components/Login';
import UserManagement from './components/UserManagement';
import PatientRegistration from './components/PatientRegistration';
import FrontDeskTriage from './components/FrontDeskTriage';
import DoctorQueues from './components/DoctorQueues';
import AuditLogs from './components/AuditLogs';
import InventoryManagement from './components/InventoryManagement';
import PatientList from './components/PatientList';
import Dashboard from './components/Dashboard';
import AdminSettings from './components/AdminSettings';
import CashierBilling from './components/CashierBilling';
import DashboardTV from './components/DashboardTV'; 
import NurseWorkspace from './components/NurseWorkspace';
import HospitalisationBeds from './components/HospitalisationBeds';
import Laboratory    from './components/Laboratory ';

const App = () => {
  const queryParams = new URLSearchParams(window.location.search);
  const isTvMode = queryParams.get('view') === 'tv';

  const [role, setRole] = useState(null);

  useEffect(() => {
    const savedRole = localStorage.getItem('role');
    const savedId = localStorage.getItem('userId');
    
    if (savedRole && savedId) {
      setRole(savedRole.toLowerCase());
    }
  }, []);

  const handleLogout = () => {
    localStorage.clear();
    setRole(null);
  };

  const handleLogin = (userRole, userId) => {
    const lowerRole = userRole.toLowerCase();
    
    // Save to localStorage for persistence
    localStorage.setItem('role', lowerRole);
    localStorage.setItem('userId', userId);

    setRole(lowerRole);
  };

  if (isTvMode) return <DashboardTV />;
  
  if (!role) {
    return <Login onLogin={handleLogin} />;
  }

  // Determines the default home route based on the user's role
  const getDefaultRoute = () => {
    if (role === 'doctor') return '/doctor_queues';
    if (role === 'nurse') return '/nurse_workspace';
    if (role === 'lab_tech') return '/laboratory';
    if (['staff', 'reception'].includes(role)) return '/triage';
    return '/dashboard';
  };

  return (
    <BrowserRouter>
      <MainLayout onLogout={handleLogout} role={role}>
        <Routes>
          <Route path="/" element={<Navigate to={getDefaultRoute()} replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/patients" element={<PatientList />} />
          <Route path="/PatientRegistration" element={<PatientRegistration />} />
          <Route path="/triage" element={<FrontDeskTriage />} />
          <Route path="/doctor_queues" element={<DoctorQueues />} />
          <Route path="/nurse_workspace" element={<NurseWorkspace />} />
          <Route path="/hospitalisation_beds" element={<HospitalisationBeds />} />
          <Route path="/inventory" element={<InventoryManagement />} />
          <Route path="/cashier" element={<CashierBilling />} />
          <Route path="/users" element={<UserManagement />} />
          <Route path="/audit_logs" element={<AuditLogs />} />
          <Route path="/admin_settings" element={<AdminSettings />} />
          <Route path="/laboratory" element={<Laboratory />} />
          {/* Catch-all route to redirect invalid URLs back to the default route */}
          <Route path="*" element={<Navigate to={getDefaultRoute()} replace />} />
        </Routes>
      </MainLayout>
    </BrowserRouter>
  );
};

export default App;