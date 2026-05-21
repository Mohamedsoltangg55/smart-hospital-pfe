import React, { useState, useEffect } from 'react';
import { Card, Table, Tag, Button, Typography, Row, Col, message, Switch, Space, Spin, Empty, Select, Modal, Form, Input, Divider, Alert, Tabs, Badge, Radio } from 'antd';
import { 
  UserOutlined, PlayCircleOutlined, BankOutlined, 
  MedicineBoxOutlined, SendOutlined, FolderOpenOutlined, FilePdfOutlined, SafetyCertificateOutlined, ExperimentOutlined 
} from '@ant-design/icons';
import client from '../api/client'; 
import useWebSocket from '../hooks/useWebSocket'; 
import dayjs from 'dayjs'; // <-- L'import manquant qui causait le crash !

const { Title, Text } = Typography;
const { Option } = Select;
const { TextArea } = Input;

const DoctorQueues = () => {
  const [queue, setQueue] = useState([]);
  const [wardPatients, setWardPatients] = useState([]);
  const [activeHospitalizations, setActiveHospitalizations] = useState([]);

  const [activePatient, setActivePatient] = useState(null);
  const [isOnline, setIsOnline] = useState(false);
  const [rooms, setRooms] = useState([]);
  const [myRoom, setMyRoom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // 🧪 NEW: Lab Catalogue from Settings
  const [labCatalogue, setLabCatalogue] = useState([]);

  // Modals
  const [isHospitalModalOpen, setIsHospitalModalOpen] = useState(false);
  const [isNurseModalOpen, setIsNurseModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isConsultModalOpen, setIsConsultModalOpen] = useState(false);
  const [isDischargeModalOpen, setIsDischargeModalOpen] = useState(false);
  const [isLabOrderModalOpen, setIsLabOrderModalOpen] = useState(false);
  const [patientToDischarge, setPatientToDischarge] = useState(null);

  // Forms
  const [form] = Form.useForm();
  const [nurseForm] = Form.useForm();
  const [consultForm] = Form.useForm();
  const [dischargeForm] = Form.useForm();
  const [labOrderForm] = Form.useForm();
  
  // History States
  const [historyData, setHistoryData] = useState([]);
  const [labHistoryData, setLabHistoryData] = useState([]);
  const [hospHistoryData, setHospHistoryData] = useState([]);

  const doctorId = localStorage.getItem('userId');
  const doctorUsername = localStorage.getItem('username');

  useEffect(() => {
    const savedDoctorStatus = localStorage.getItem(`doctor_${doctorId}_status`);
    const savedRoomNumber = localStorage.getItem(`doctor_${doctorId}_room`);
    if (savedDoctorStatus === 'true') {
      setIsOnline(true);
      if (savedRoomNumber) setMyRoom(savedRoomNumber);
    }
  }, [doctorId]);

  const selectedRoomForHosp = Form.useWatch('room', form);

  const superParse = (data) => {
    if (!data || data === "[]" || data === "") return [];
    if (Array.isArray(data)) return data;
    try {
      let p = typeof data === 'string' ? JSON.parse(data) : data;
      if (typeof p === 'string') p = JSON.parse(p);
      return Array.isArray(p) ? p : [];
    } catch (e) {
      try { return JSON.parse(data.replace(/'/g, '"')); } catch (err) { return []; }
    }
  };

  const fetchData = async () => {
    if (!doctorId || doctorId === "undefined" || doctorId === "null") {
      setLoading(false); return;
    }

    try {
      const t = new Date().getTime();

      try {
        const sRes = await client.get(`/settings?t=${t}`);
        setRooms(superParse(sRes.data.rooms));
        
        // Fetch dynamic Lab Catalogue
        const allPrices = superParse(sRes.data.prices);
        setLabCatalogue(allPrices.filter(item => item.type === 'Laboratoire'));
      } catch (e) { console.error("Failed to load settings"); }

      try {
        const uRes = await client.get(`/users/`);
        const me = uRes.data.find(u => String(u.id) === String(doctorId));
        if (me) { setIsOnline(me.is_online); setMyRoom(me.room_number); }
      } catch (e) { console.error("Failed to load user profile"); }

      await fetchDoctorQueue();

      try {
        const hRes = await client.get('/hospitalizations/active');
        setActiveHospitalizations(hRes.data || []);
        setWardPatients((hRes.data || []).filter(h => h.doctor_id === parseInt(doctorId)));
      } catch (e) { console.error('Error fetching hospitalizations:', e); }

      setLoading(false);
    } catch (e) { console.error("Critical Sync Error:", e); setLoading(false); }
  };

  const fetchDoctorQueue = async () => {
    try {
      const res = await client.get(`/doctor/queue/${doctorId}`);
      setQueue(res.data || []);
    } catch (e) { console.error('Error fetching updated queue:', e); }
  };

  const handleAppointmentMessage = (data) => {
    if (data.type === 'appointment_update') {
      // Defensive: backend may send a trimmed payload. If items contain
      // the full shape use them, otherwise refresh from canonical HTTP endpoint.
      const items = data.appointments || [];
      const looksGood = items.length > 0 && items[0].appointment && items[0].patient;
      if (looksGood) {
        setQueue(items);
      } else {
        // fallback to canonical fetch to avoid replacing queue with incomplete shape
        fetchDoctorQueue().catch(() => setQueue(items));
      }
    } else if (data.type === 'new_appointment' && data.doctor_id === parseInt(doctorId)) {
      fetchDoctorQueue();
    } else if (data.type === 'appointment_status_changed' && data.doctor_id === parseInt(doctorId)) {
      setQueue(q => q.map(appt => appt?.appointment?.id === data.appointment_id ? { ...appt, appointment: { ...appt.appointment, status: data.new_status } } : appt));
    }
  };

  const handleHospitalizationMessage = (data) => {
    if (data.type === 'hospitalization_update') {
      setActiveHospitalizations(data.hospitalizations || []);
      setWardPatients((data.hospitalizations || []).filter(h => h.doctor_id === parseInt(doctorId)));
    } else if (data.type === 'patient_admitted') {
      setActiveHospitalizations(prev => [...prev, data]);
      setWardPatients(prev => [...prev, data]);
    } else if (data.type === 'patient_discharged') {
      setActiveHospitalizations(prev => prev.filter(h => h.id !== data.hospitalization_id));
      setWardPatients(prev => prev.filter(h => h.id !== data.hospitalization_id));
    }
  };

  useWebSocket(`/ws/appointments/${doctorId}`, handleAppointmentMessage, [doctorId]);
  useWebSocket(`/ws/hospitalizations`, handleHospitalizationMessage, []);

  useEffect(() => { fetchData(); }, [doctorId]);

  const toggleStatus = async (checked) => {
    if (checked && !myRoom) return message.warning("Please select a room first!");
    try {
      await client.patch(`/doctors/${doctorId}/status?is_online=${checked}&room_number=${myRoom}`);
      setIsOnline(checked);
      localStorage.setItem(`doctor_${doctorId}_status`, String(checked));
      if (checked && myRoom) localStorage.setItem(`doctor_${doctorId}_room`, myRoom);
      message.success(checked ? `ONLINE in ${myRoom}` : "OFFLINE.");
    } catch (error) { message.error("Failed to update doctor status"); }
  };

  const handleCallPatient = async (id, data) => {
    try {
      await client.patch(`/appointments/${id}/status`, { status: "In Progress" });
      setActivePatient(data);
      message.success("Patient called successfully!");
    } catch (error) { message.error("Failed to call patient."); }
  };

  // --- 🗂️ UPGRADED MEDICAL FOLDER (CONSULTS + LABS) ---
  const loadHistory = async () => {
    const pId = activePatient?.patient?.id || activePatient?.patient_id;
    if (!pId) return message.warning("Select a patient first.");

    try {
      const [consultRes, labRes, hospRes] = await Promise.all([
        client.get(`/patients/${pId}/folder?role=doctor&doctor_username=${doctorUsername}`),
        client.get(`/lab/patient/${pId}`),
        client.get(`/hospitalizations/history?patient_id=${pId}`).catch(() => ({ data: [] }))
      ]);
      setHistoryData(consultRes.data || []);
      setLabHistoryData(labRes.data || []);
      setHospHistoryData(hospRes.data || []);
      setIsHistoryModalOpen(true);
    } catch (error) { message.error("Failed to load medical history."); }
  };

  // --- 📝 CONSULTATION ---
  const handleEndConsultation = async (values) => {
    if (!activePatient?.appointment?.id) return message.warning("Please call a patient first.");
    setActionLoading(true);
    try {
      await client.patch(`/appointments/${activePatient.appointment.id}/consultation`, {
        diagnosis: values.diagnosis, treatment: values.treatment, user: doctorUsername
      });
      message.success("Consultation Saved!");
      setIsConsultModalOpen(false); consultForm.resetFields(); setActivePatient(null); fetchData(); 
    } catch (e) { message.error("Failed to save."); } finally { setActionLoading(false); }
  };

  // --- 🛏️ ADMISSION ---
  const handleHospitalize = async (values) => {
    setActionLoading(true);
    try {
      const roomDetails = rooms.find(r => r.name === values.room.split('|')[1]);
      await client.post('/hospitalizations/', {
        patient_id: activePatient.patient.id,
        patient_name: `${activePatient.patient.first_name} ${activePatient.patient.last_name}`,
        department: roomDetails?.department || "General",
        room_name: roomDetails?.name || values.room,
        bed_number: values.bed,
        admission_date: new Date().toISOString().slice(0, 16).replace('T', ' '),
        doctor_id: parseInt(doctorId),
        doctor_name: doctorUsername
      });
      message.success(`Patient admitted to ${values.bed} in ${roomDetails.name}`);
      setIsHospitalModalOpen(false); form.resetFields(); fetchData();
    } catch (e) { message.error(e.response?.data?.detail || "Admission failed."); } finally { setActionLoading(false); }
  };

  // --- 🚪 DISCHARGE ---
  const handleDischarge = async (values) => {
    setActionLoading(true);
    try {
      await client.patch(`/hospitalizations/${patientToDischarge.id}/discharge`, { doctor_name: doctorUsername });
      const printWindow = window.open('', '_blank');
      printWindow.document.write(`
        <html><head><title>Lettre de Sortie</title><style>body { font-family: Arial; padding: 40px; line-height: 1.6; } .header { text-align: center; border-bottom: 2px solid #10B981; padding-bottom: 20px; }</style></head>
        <body><div class="header"><h1 style="color: #10B981; margin:0;">🏥 Smart Hospital</h1><h2>Lettre de Sortie</h2><p>Dr. ${doctorUsername}</p></div>
        <h3>Patient: ${patientToDischarge.patient_name}</h3><p>${values.summary.replace(/\n/g, '<br/>')}</p></body></html>
      `);
      printWindow.document.close();
      setTimeout(() => { printWindow.print(); }, 500);

      message.success("Patient Discharged.");
      setIsDischargeModalOpen(false); setPatientToDischarge(null); dischargeForm.resetFields(); fetchData();
    } catch (e) { message.error("Failed to discharge."); } finally { setActionLoading(false); }
  };

  // --- 🧪 LAB ORDERING ---
  const handleOrderLab = async (values) => {
    setActionLoading(true);
    try {
      await client.post('/lab/orders', {
        patient_id: activePatient.patient.id,
        doctor_id: parseInt(doctorId),
        doctor_name: doctorUsername,
        test_name: values.lab_tests.join(', '),
        test_category: "Consultation",
        clinical_notes: values.notes || "Demande depuis le cabinet",
        urgency: values.urgency || "Normal",
        appointment_id: activePatient.appointment.id
      });
      message.success("Analyses demandées ! Le laboratoire a été notifié.");
      setIsLabOrderModalOpen(false); labOrderForm.resetFields();
    } catch (e) { message.error("Échec de la demande d'analyses."); } finally { setActionLoading(false); }
  };

  const renderBedOptions = () => {
    if (!selectedRoomForHosp) return <Option disabled>Veuillez choisir une salle</Option>;
    const roomName = selectedRoomForHosp.split('|')[1];
    const roomDetails = rooms.find(r => r.name === roomName);
    if (!roomDetails) return [];
    const capacity = roomDetails.capacity || 1;
    const beds = [];
    for (let i = 1; i <= capacity; i++) {
      const bedName = `Lit ${i.toString().padStart(2, '0')}`;
      const isOccupied = activeHospitalizations.some(h => h.room_name === roomName && h.bed_number === bedName);
      beds.push(<Option key={bedName} value={bedName} disabled={isOccupied}>{bedName} {isOccupied ? "🔴 (Occupé)" : "🟢 (Libre)"}</Option>);
    }
    return beds;
  };

  if (loading) return <div style={{ textAlign: 'center', marginTop: 100 }}><Spin size="large" /></div>;

  return (
    <div style={{ padding: '30px', backgroundColor: '#f0f2f5', minHeight: '100vh' }}>
      <Card style={{ marginBottom: 20, borderRadius: '12px' }}>
        <Row align="middle" justify="space-between">
          <Col>
            <Space size="large">
              <Title level={4} style={{ margin: 0 }}><UserOutlined /> Dr. {doctorUsername}</Title>
              <Select placeholder="Choose Salle / Cabinet" value={myRoom} onChange={setMyRoom} style={{ width: 300 }} disabled={isOnline}>
                {rooms.map(r => <Option key={r.id || r.name} value={r.name}><b>{r.name}</b> ({r.department})</Option>)}
              </Select>
              <Space><Switch checked={isOnline} onChange={toggleStatus} /><Tag color={isOnline ? "green" : "red"}>{isOnline ? "ONLINE" : "OFFLINE"}</Tag></Space>
            </Space>
          </Col>
        </Row>
      </Card>

      <Row gutter={24}>
        <Col span={10}>
          <Card style={{ borderRadius: '12px', minHeight: '550px' }}>
            <Tabs defaultActiveKey="1" items={[
              { key: "1", label: "Salle d'Attente (Triage)", children: <Table dataSource={queue} columns={[
                { title: 'Ticket', render: (_, r) => <Tag color="blue">{r?.appointment?.ticket_number ?? '—'}</Tag> },
                { title: 'Patient Name', render: (_, r) => <Text strong>{r?.patient?.first_name ?? 'Unknown'} {r?.patient?.last_name ?? ''}</Text> },
                { title: 'Action', render: (_, r) => (r?.appointment?.status === "Waiting") ? <Button icon={<PlayCircleOutlined />} type="primary" onClick={() => handleCallPatient(r?.appointment?.id, r)}>Call Next</Button> : <Button icon={<MedicineBoxOutlined />} onClick={() => setActivePatient(r)}>Examine</Button> }
              ]} rowKey={r => r?.appointment?.id} pagination={{ pageSize: 5 }} /> },
              { key: "2", label: `Mes Patients Hospitalisés (${wardPatients.length})`, children: <Table dataSource={wardPatients} columns={[
                { title: 'Patient', dataIndex: 'patient_name', render: t => <b>{t}</b> },
                { title: 'Salle', dataIndex: 'room_name', render: t => <Tag color="purple">{t}</Tag> },
                { title: 'Lit', dataIndex: 'bed_number', render: t => <Tag color="cyan">{t}</Tag> },
                { title: 'Action', render: (_, r) => <Button type="primary" danger icon={<SafetyCertificateOutlined />} onClick={() => { setPatientToDischarge(r); setIsDischargeModalOpen(true); }}>Sortie</Button> }
              ]} rowKey="id" pagination={{ pageSize: 5 }} /> }
            ]} />
          </Card>
        </Col>

        <Col span={14}>
          {activePatient ? (
            <Card title={<Title level={4} style={{ margin: 0 }}>Consultation: {activePatient?.patient?.first_name ?? 'Patient'} {activePatient?.patient?.last_name ?? ''}</Title>} extra={<Tag color="green">IN PROGRESS</Tag>} style={{ borderRadius: '12px', minHeight: '550px' }}>
              <Text type="secondary">Ticket: {activePatient?.appointment?.ticket_number ?? '—'} | NSS: {activePatient?.patient?.nss || 'N/A'}</Text>
              <Divider />
              <Title level={5}>Clinical Decision Center</Title>
              <Row gutter={[16, 16]} style={{ marginTop: '20px' }}>
                <Col span={8}><Card hoverable onClick={loadHistory} style={{ textAlign: 'center', borderColor: '#722ed1', background: '#f9f0ff', height: '100%' }}><FolderOpenOutlined style={{ fontSize: '32px', color: '#722ed1' }} /><Title level={5} style={{ marginTop: 10 }}>Medical Folder</Title></Card></Col>
                <Col span={8}><Card hoverable onClick={() => setIsLabOrderModalOpen(true)} style={{ textAlign: 'center', borderColor: '#eb2f96', background: '#fff0f6', height: '100%' }}><ExperimentOutlined style={{ fontSize: '32px', color: '#eb2f96' }} /><Title level={5} style={{ marginTop: 10 }}>Order Lab Tests</Title></Card></Col>
                <Col span={8}><Card hoverable onClick={() => setIsConsultModalOpen(true)} style={{ textAlign: 'center', borderColor: '#cf1322', background: '#fff1f0', height: '100%' }}><FilePdfOutlined style={{ fontSize: '32px', color: '#cf1322' }} /><Title level={5} style={{ marginTop: 10 }}>Write Ordonnance</Title></Card></Col>
                <Col span={12}><Card hoverable onClick={() => setIsHospitalModalOpen(true)} style={{ textAlign: 'center', borderColor: '#1890ff', height: '100%' }}><BankOutlined style={{ fontSize: '32px', color: '#1890ff' }} /><Title level={5} style={{ marginTop: 10 }}>Admit to Ward</Title></Card></Col>
                <Col span={12}><Card hoverable onClick={() => setIsNurseModalOpen(true)} style={{ textAlign: 'center', borderColor: '#52c41a', height: '100%' }}><SendOutlined style={{ fontSize: '32px', color: '#52c41a' }} /><Title level={5} style={{ marginTop: 10 }}>Nurse Task</Title></Card></Col>
              </Row>
            </Card>
          ) : <Card style={{ height: '550px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '12px' }}><Empty description="Desk is clear." /></Card>}
        </Col>
      </Row>

      {/* 🧪 NEW LAB ORDER MODAL */}
      <Modal title="Demander des Analyses (Laboratoire)" open={isLabOrderModalOpen} onCancel={() => setIsLabOrderModalOpen(false)} onOk={() => labOrderForm.submit()} okText="Envoyer au Labo" confirmLoading={actionLoading}>
        <Alert message="La demande sera immédiatement transmise au tableau de bord du laboratoire." type="info" showIcon style={{ marginBottom: 15 }} />
        <Form form={labOrderForm} layout="vertical" onFinish={handleOrderLab} initialValues={{ urgency: "Normal" }}>
          <Form.Item name="lab_tests" label="Sélectionner les Analyses" rules={[{ required: true, message: 'Requis' }]}>
            <Select mode="multiple" size="large" placeholder="Ex: FNS, Glycémie" disabled={labCatalogue.length === 0}>
              {labCatalogue.map(test => <Option key={test.name} value={test.name}>{test.name}</Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="urgency" label="Priorité">
            <Radio.Group>
              <Radio.Button value="Normal">Normal</Radio.Button>
              <Radio.Button value="Urgent">Urgent</Radio.Button>
              <Radio.Button value="STAT" style={{ color: 'red' }}>STAT (Critique)</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="notes" label="Notes Cliniques (Optionnel)">
            <TextArea rows={2} placeholder="Ex: Patient diabétique, vérifier HbA1c de près." />
          </Form.Item>
        </Form>
      </Modal>

      {/* 🗂️ UPGRADED HISTORY MODAL WITH TABS */}
      <Modal title="Dossier Médical du Patient" open={isHistoryModalOpen} onCancel={() => setIsHistoryModalOpen(false)} footer={null} width={800} bodyStyle={{ minHeight: 400 }}>
        <Tabs defaultActiveKey="1" items={[
          { key: "1", label: "Consultations Passées", children: (
            historyData.length === 0 ? <Empty description="Aucune consultation" /> :
            <Table rowKey="id" pagination={false} dataSource={historyData} size="small" columns={[
              { title: 'Date', dataIndex: 'scheduled_time', render: v => v ? dayjs(v).format('DD/MM/YYYY') : '—' },
              { title: 'Docteur', dataIndex: 'doctor_name' },
              { title: 'Diagnostic', dataIndex: 'diagnosis' },
              { title: 'Traitement', dataIndex: 'treatment' }
            ]}/>
          )},
          { key: "2", label: "Résultats Laboratoire", children: (
            labHistoryData.length === 0 ? <Empty description="Aucune analyse" /> :
            <Table rowKey="id" pagination={false} dataSource={labHistoryData} size="small" expandable={{
              expandedRowRender: record => (
                <Table dataSource={record.results} rowKey="parameter" pagination={false} size="small" columns={[
                  { title: 'Paramètre', dataIndex: 'parameter' },
                  { title: 'Valeur', dataIndex: 'value', render: (v, r) => <Text strong style={{ color: r.flag === 'Normal' ? 'black' : 'red'}}>{v}</Text> },
                  { title: 'Unité', dataIndex: 'unit' },
                  { title: 'Interprétation', dataIndex: 'flag', render: f => <Tag color={f === 'Normal' ? 'green' : 'red'}>{f}</Tag> },
                ]}/>
              )
            }} columns={[
              { title: 'Date', dataIndex: 'ordered_at', render: v => v ? dayjs(v).format('DD/MM/YYYY HH:mm') : '—' },
              { title: 'Analyses Demandées', dataIndex: 'test_name' },
              { title: 'Statut', dataIndex: 'status', render: s => <Tag color={s === 'Completed' || s === 'Validated' ? 'green' : 'orange'}>{s}</Tag> },
              { title: 'Technicien', dataIndex: 'lab_tech_name' }
            ]}/>
          )},
          { key: "3", label: "Hospitalisations", children: (
            hospHistoryData.length === 0 ? <Empty description="Aucun historique d'hospitalisation" /> :
            <Table rowKey="id" pagination={false} dataSource={hospHistoryData} size="small" columns={[
              { title: 'Date d\'Admission', dataIndex: 'admission_date', render: v => v ? dayjs(v).format('DD/MM/YYYY HH:mm') : '—' },
              { title: 'Département', dataIndex: 'department' },
              { title: 'Chambre/Lit', render: (_, r) => `${r.room_name} - Lit ${r.bed_number}` },
              { title: 'Statut', dataIndex: 'status', render: s => <Tag color={s === 'Discharged' ? 'gray' : 'green'}>{s === 'Discharged' ? 'Sorti' : 'Occupé'}</Tag> },
              { title: 'Date de Sortie', dataIndex: 'discharge_date', render: (v, r) => {
                  if (r.status !== 'Discharged') return '—';
                  if (!v) return '—';
                  const start = dayjs(r.admission_date);
                  const end = dayjs(v);
                  const days = end.diff(start, 'day');
                  const hours = end.diff(start, 'hour') % 24;
                  return <span>{dayjs(v).format('DD/MM/YYYY HH:mm')}<br/><small style={{color:'gray'}}>Durée: {days}j {hours}h</small></span>;
                }
              }
            ]}/>
          )}
        ]} />
      </Modal>

      {/* 🛏️ HOSPITALIZATION MODAL */}
      <Modal title="Réserver un Lit" open={isHospitalModalOpen} onCancel={() => setIsHospitalModalOpen(false)} onOk={() => form.submit()} confirmLoading={actionLoading}>
        <Form form={form} layout="vertical" onFinish={handleHospitalize}>
          <Form.Item name="room" label="Salle / Chambre" rules={[{ required: true }]}>
            <Select>{rooms.filter(r => !r.type?.toLowerCase().includes("cabinet")).map(r => <Option key={`hosp-${r.id || r.name}`} value={`${r.department}|${r.name}`}>{r.department} - {r.name}</Option>)}</Select>
          </Form.Item>
          <Form.Item name="bed" label="Lit" rules={[{ required: true }]}><Select>{renderBedOptions()}</Select></Form.Item>
        </Form>
      </Modal>

      {/* 🚪 DISCHARGE MODAL */}
      <Modal title="Autorisation de Sortie" open={isDischargeModalOpen} onCancel={() => setIsDischargeModalOpen(false)} onOk={() => dischargeForm.submit()} okText="Imprimer Bon de Sortie" okButtonProps={{ danger: true }} confirmLoading={actionLoading}>
        <Form form={dischargeForm} layout="vertical" onFinish={handleDischarge}>
          <Form.Item name="summary" label="Résumé d'Hospitalisation" rules={[{ required: true }]}><TextArea rows={5} /></Form.Item>
        </Form>
      </Modal>

      {/* 📝 CONSULTATION MODAL */}
      <Modal title="Consultation & Ordonnance" open={isConsultModalOpen} onCancel={() => setIsConsultModalOpen(false)} onOk={() => consultForm.submit()} okText="Save & Print PDF" confirmLoading={actionLoading} width={600}>
        <Form form={consultForm} layout="vertical" onFinish={handleEndConsultation}>
          <Form.Item name="diagnosis" label="Diagnosis" rules={[{ required: true }]}><TextArea rows={3} /></Form.Item>
          <Form.Item name="treatment" label="Prescription" rules={[{ required: true }]}><TextArea rows={4} /></Form.Item>
        </Form>
      </Modal>

      {/* 💉 NURSE MODAL */}
      <Modal title="Nurse Task" open={isNurseModalOpen} onCancel={() => setIsNurseModalOpen(false)} onOk={() => nurseForm.submit()}>
        <Form form={nurseForm} layout="vertical" onFinish={async (v) => { await client.post('/nursing-tasks', { patient_name: activePatient?.patient.first_name, task_description: v.task, room_number: myRoom, status: "Pending" }); setIsNurseModalOpen(false); nurseForm.resetFields(); message.success("Sent."); }}>
          <Form.Item name="task" rules={[{ required: true }]}><TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default DoctorQueues;