import React, { useState, useEffect } from 'react';
import { Typography, Card, Button, Spin, Row, Col } from 'antd';
import { MedicineBoxOutlined, ClockCircleOutlined, DesktopOutlined, SoundOutlined, ArrowRightOutlined } from '@ant-design/icons';
import client from '../api/client';
import dayjs from 'dayjs';
import useWebSocket from '../hooks/useWebSocket';

const { Title, Text } = Typography;

// Helper to remove accents and make comparison flawless
const normalizeString = (str) => {
  return (str || '').toString().toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
};

const DashboardTV = () => {
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [urgencies, setUrgencies] = useState([]);
  const [standards, setStandards] = useState([]);
  const [doctors, setDoctors] = useState([]); 
  const [services, setServices] = useState([]);
  
  const [tvDepartment, setTvDepartment] = useState(() => {
    const saved = localStorage.getItem('saved_tv_dept');
    if (!saved) return null;
    try { return JSON.parse(saved); } catch (error) { return null; }
  });

  const [hospitalName, setHospitalName] = useState('SMART CLINIC');
  const [announcement, setAnnouncement] = useState('Welcome. Please have your ID ready.');
  const [currentTime, setCurrentTime] = useState(dayjs().format('HH:mm:ss'));

  const handleWsMessage = (data) => {
    if (data.type === 'new_appointment' || data.type === 'appointment_status_changed') {
      setTimeout(() => fetchQueueData(), 300);
      if (data.type === 'appointment_status_changed' && data.new_status === 'In Progress') {
        const audio = new Audio('/ding.mp3'); 
        audio.play().catch(e => console.warn('Audio error (Requires user interaction first)'));
      }
    }
  };
  
  useWebSocket('/ws/tv', handleWsMessage, []);

  useEffect(() => {
    setLoadingAuth(false);
  }, []);

  const fetchQueueData = async () => {
    if (!tvDepartment) return;
    try {
      const res = await client.get('/appointments/all');
      
      const selectedServiceRaw = tvDepartment.name || tvDepartment;
      const selectedService = normalizeString(selectedServiceRaw);
      
      const isGlobal = selectedService === 'all departments (global)' || selectedService === 'global';

      const filtered = res.data.filter(a => {
        // 1. Is it an active ticket?
        const isActive = ['Waiting', 'In Progress', 'Triage'].includes(a.status);// Removed 'Triage' to avoid showing unprocessed
        if (!isActive) return false;

        // 2. Global bypass
        if (isGlobal) return true;

        // 3. Find the assigned doctor to cross-reference their specialty
        const assignedDoc = doctors.find(d => d.id === a.doctor_id);
        const docSpecialty = normalizeString(assignedDoc?.specialty);
        const apptService = normalizeString(a.service);

        // 4. Match logic: TV Pole vs (Billed Service OR Doctor Specialty)
        const isMatch = 
          apptService === selectedService || 
          apptService.includes(selectedService) || 
          selectedService.includes(apptService) ||
          (docSpecialty && (docSpecialty === selectedService || docSpecialty.includes(selectedService) || selectedService.includes(docSpecialty)));

        return isMatch;
      });

      const sortedAppts = filtered.sort((a, b) => {
        if (a.status === 'In Progress' && b.status !== 'In Progress') return -1;
        if (a.status !== 'In Progress' && b.status === 'In Progress') return 1;
        if (a.priority === 'Emergency' && b.priority !== 'Emergency') return -1;
        if (a.priority !== 'Emergency' && b.priority === 'Emergency') return 1;
        return (a.ticket_number || '').localeCompare(b.ticket_number || '');
      });

      setUrgencies(sortedAppts.filter(a => a.priority === 'Emergency'));
      setStandards(sortedAppts.filter(a => a.priority !== 'Emergency'));
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(dayjs().format('HH:mm:ss')), 1000);
    const loadSettings = async () => {
      try {
        const [s, d] = await Promise.all([client.get('/settings').catch(()=>({data:{}})), client.get('/doctors').catch(()=>({data:[]}))]);
        if (d.data) setDoctors(d.data);
        if (s.data) {
          setHospitalName(s.data.hospital_name || 'SMART CLINIC');
          if(s.data.tv_announcement) setAnnouncement(s.data.tv_announcement);
          
          let parsedServices = [];
          try { parsedServices = JSON.parse(s.data.services || '[]'); } catch(e) {}
          setServices([{ name: 'ALL DEPARTMENTS (GLOBAL)' }, ...parsedServices]);
        }
        await fetchQueueData();
      } catch (e) {
        console.error("TV loading error:", e);
      }
    };
    loadSettings();
    // Auto-refresh every 10 seconds just in case WebSockets fail
    const interval = setInterval(fetchQueueData, 10000); 
    return () => { clearInterval(timer); clearInterval(interval); };
  }, [tvDepartment, doctors.length]); // Added doctors.length as dependency so it refetches when doctors load

  const getRoom = (id) => doctors.find(d => d.id === id)?.room_number || `ROOM ${id || '?'}`;

  if (loadingAuth) return <div style={{height:'100vh', background:'#0a0a0a', display:'flex', justifyContent:'center', alignItems:'center'}}><Spin size="large" /></div>;

  // --- TV SETUP SCREEN ---
  if (!tvDepartment) {
    return (
      <div style={{ height: '100vh', backgroundColor: '#0a0a0a', display: 'flex', justifyContent: 'center', alignItems: 'center', animation: 'fadeIn 0.5s' }}>
        <Card style={{ background: '#1c1c1e', border: '1px solid #333', borderRadius: '16px', padding: '40px', width: '800px', textAlign: 'center' }}>
          <DesktopOutlined style={{ fontSize: '64px', color: '#1677ff', marginBottom: '20px' }} />
          <Title level={2} style={{ color: '#fff' }}>Screen Configuration</Title>
          <Text style={{ color: '#aaa', display: 'block', marginBottom: '30px', fontSize: '18px' }}>Select the department to display on this TV.</Text>
          <Row gutter={[16, 16]} justify="center">
            {services.map(s => (
              <Col span={12} key={s.name || s}>
                <Button 
                  block 
                  type={(s.name || s).includes('GLOBAL') ? 'primary' : 'default'} 
                  size="large" 
                  style={{ 
                    height: '60px', 
                    fontSize: '16px', 
                    fontWeight: 'bold', 
                    background: (s.name || s).includes('GLOBAL') ? '#1677ff' : '#2d2d2d',
                    color: '#fff',
                    borderColor: '#333'
                  }} 
                  onClick={() => { 
                    setTvDepartment(s); 
                    localStorage.setItem('saved_tv_dept', JSON.stringify(s)); 
                  }}
                >
                  {(s.name || s).toUpperCase()}
                </Button>
              </Col>
            ))}
          </Row>
          <Button type="link" style={{ marginTop: 30, color: '#666' }} onClick={() => localStorage.removeItem('saved_tv_dept')}>
            Reset
          </Button>
        </Card>
      </div>
    );
  }

  // --- TV DISPLAY LOGIC ---
  const allTickets = [...urgencies, ...standards];
  const inProgressTickets = allTickets.filter(a => a.status === 'In Progress');
  const waitingTickets = allTickets.filter(a => a.status !== 'In Progress');

  // We only show the MOST RECENT "In Progress" as the main big ticket
  const currentTicket = inProgressTickets.length > 0 ? inProgressTickets[0] : null;

  return (
    <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', backgroundColor: '#000', color: '#fff', fontFamily: 'system-ui, sans-serif', overflow: 'hidden' }}>
      
      {/* HEADER */}
      <header style={{ height: '120px', backgroundColor: '#0a0a0a', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 50px', borderBottom: '1px solid #222' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '30px' }}>
          <div style={{ background: '#1677ff', borderRadius: '15px', padding: '15px', display: 'flex', alignItems: 'center', cursor: 'pointer' }} onDoubleClick={() => { setTvDepartment(null); localStorage.removeItem('saved_tv_dept'); }}>
             <MedicineBoxOutlined style={{ fontSize: '50px', color: '#fff' }} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '38px', color: '#fff', fontWeight: 900, letterSpacing: '1px' }}>{hospitalName}</h1>
            <div style={{ color: '#1677ff', fontSize: '22px', fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase' }}>
              {(tvDepartment.name || tvDepartment)}
            </div>
          </div>
        </div>
        <div style={{ fontSize: '55px', fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'center', gap: '20px' }}>
          <ClockCircleOutlined style={{color: '#333'}} />
          {currentTime}
        </div>
      </header>

      {/* CONTENT */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        
        {/* LEFT: NOW CALLING */}
        <div style={{ flex: 5, display: 'flex', flexDirection: 'column', borderRight: '1px solid #222' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '40px', position: 'relative' }}>
            
            <h2 style={{ position: 'absolute', top: '40px', margin: 0, fontSize: '40px', color: '#fff', fontWeight: 800, letterSpacing: '2px' }}>
              NOW CALLING
            </h2>

            {currentTicket ? (
              <div style={{ 
                  width: '100%', maxWidth: '850px', marginTop: '60px',
                  background: currentTicket.priority === 'Emergency' ? 'linear-gradient(135deg, #450a0a 0%, #7f1d1d 100%)' : 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)', 
                  borderRadius: '40px', padding: '80px 60px', textAlign: 'center', 
                  border: `4px solid ${currentTicket.priority === 'Emergency' ? '#ef4444' : '#3b82f6'}`,
                  boxShadow: `0 30px 60px rgba(${currentTicket.priority === 'Emergency' ? '239,68,68' : '59,130,246'}, 0.3)`,
                  animation: 'zoomIn 0.5s ease-out'
                }}>
                <div style={{ fontSize: '35px', color: '#cbd5e1', fontWeight: 600, textTransform: 'uppercase', marginBottom: '20px' }}>TICKET NUMBER</div>
                <div style={{ fontSize: '180px', fontWeight: 900, color: '#fff', lineHeight: 1, marginBottom: '20px', letterSpacing: '5px' }}>
                  {currentTicket.ticket_number || '---'}
                </div>
                <div style={{ fontSize: '48px', color: '#e2e8f0', fontWeight: 600, marginBottom: '60px', opacity: 0.9 }}>
                  {currentTicket.first_name} {currentTicket.last_name ? currentTicket.last_name.charAt(0) + '.' : ''}
                </div>
                
                <div style={{ backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: '25px', padding: '40px', display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: '28px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', marginBottom: '10px' }}>PLEASE PROCEED TO</div>
                    <div style={{ fontSize: '65px', fontWeight: 900, color: '#fbbf24', lineHeight: 1 }}>
                      {getRoom(currentTicket.doctor_id).toUpperCase()}
                    </div>
                  </div>
                  <ArrowRightOutlined style={{ fontSize: '100px', color: '#fbbf24', animation: 'pulse 1.5s infinite' }} />
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', opacity: 0.3, marginTop: '80px' }}>
                <SoundOutlined style={{ fontSize: '150px', marginBottom: '40px' }} />
                <h2 style={{ fontSize: '50px' }}>Waiting for the next patient...</h2>
              </div>
            )}
            
            {/* OTHER IN PROGRESS (If multiple doctors are calling at once) */}
            {inProgressTickets.length > 1 && (
              <div style={{ position: 'absolute', bottom: '30px', left: '40px', right: '40px', display: 'flex', gap: '20px', overflowX: 'auto', padding: '10px' }}>
                {inProgressTickets.slice(1, 4).map(t => (
                  <div key={t.id} style={{ background: '#111', padding: '20px 30px', borderRadius: '20px', borderLeft: `5px solid ${t.priority === 'Emergency' ? '#ef4444' : '#3b82f6'}`, minWidth: '280px' }}>
                     <div style={{ color: '#94a3b8', fontSize: '18px', fontWeight: 800, textTransform: 'uppercase' }}>TICKET {t.ticket_number}</div>
                     <div style={{ color: '#fff', fontSize: '28px', fontWeight: 800, marginTop: '10px' }}>{getRoom(t.doctor_id)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: WAITING LIST */}
        <div style={{ flex: 3, display: 'flex', flexDirection: 'column', backgroundColor: '#050505' }}>
          <div style={{ padding: '40px 40px 20px 40px' }}>
            <h2 style={{ margin: 0, fontSize: '35px', color: '#fff', fontWeight: 800, letterSpacing: '1px' }}>WAITING QUEUE</h2>
          </div>
          
          <div style={{ flex: 1, padding: '0 40px 40px 40px', overflowY: 'hidden' }}>
            {waitingTickets.length === 0 ? (
              <div style={{ height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#333', fontSize: '30px', fontWeight: 800 }}>
                QUEUE EMPTY
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>                
                {waitingTickets.slice(0, 7).map((p) => (
                  <div key={p.id} style={{ 
                    display: 'flex', alignItems: 'center', padding: '25px 30px', 
                    backgroundColor: p.priority === 'Emergency' ? 'rgba(239, 68, 68, 0.1)' : '#111', 
                    borderRadius: '20px', borderLeft: `8px solid ${p.priority === 'Emergency' ? '#ef4444' : '#333'}`,
                    animation: 'fadeIn 0.5s ease-in'
                  }}>
                    <div style={{ width: '150px', fontSize: '35px', fontWeight: 900, color: p.priority === 'Emergency' ? '#ef4444' : '#fff' }}>
                      {p.ticket_number || '---'}
                    </div>
                    <div style={{ flex: 1, fontSize: '28px', fontWeight: 600, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.first_name || 'Patient'}
                    </div>
                  </div>
                ))}
                {waitingTickets.length > 7 && (
                  <div style={{ textAlign: 'center', color: '#666', fontSize: '24px', fontWeight: 'bold', marginTop: '10px' }}>
                    + {waitingTickets.length - 7} MORE WAITING...
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        
      </div>

      {/* FOOTER MARQUEE */}
      <footer style={{ height: '80px', backgroundColor: '#1677ff', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center' }}>
        <div style={{ whiteSpace: 'nowrap', animation: 'marquee 30s linear infinite', fontSize: '35px', fontWeight: 800, color: '#fff', textTransform: 'uppercase', letterSpacing: '4px' }}>
          *** {announcement} *** THANK YOU FOR YOUR PATIENCE ***
        </div>
      </footer>
      
      <style>{`
        @keyframes marquee {
          0% { transform: translateX(100vw); }
          100% { transform: translateX(-100%); }
        }
        @keyframes zoomIn {
          from { transform: scale(0.9); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @keyframes pulse {
          0% { transform: translateX(0); }
          50% { transform: translateX(10px); }
          100% { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
};

export default DashboardTV;