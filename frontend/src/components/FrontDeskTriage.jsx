import React, { useState, useEffect } from 'react';
import { Card, Form, Select, Button, Typography, Row, Col, message, Radio, Modal, Spin, DatePicker, Space, Divider } from 'antd';
import { ExperimentOutlined, UserOutlined, CalendarOutlined, ClockCircleOutlined, MedicineBoxOutlined } from '@ant-design/icons';
import client from '../api/client';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { Option } = Select;

const FrontDeskTriage = () => {
  const [form] = Form.useForm();
  const [patients, setPatients] = useState([]);
  const [staff, setStaff] = useState([]); 
  const [cabinets, setCabinets] = useState([]); 
  const [departments, setDepartments] = useState([]);
  
  // Dynamic states for Pricing & Rooms
  const [labCatalogue, setLabCatalogue] = useState([]);
  const [consultationCatalogue, setConsultationCatalogue] = useState([]);
  const [nurseRooms, setNurseRooms] = useState([]);
  
  const [loading, setLoading] = useState(true);

  // Watch fields to dynamically change the UI
  const visitType = Form.useWatch('visit_type', form);
  const orientation = Form.useWatch('orientation', form);

  const superParse = (data) => {
    try {
      let p = typeof data === 'string' ? JSON.parse(data) : data;
      if (typeof p === 'string') p = JSON.parse(p);
      return Array.isArray(p) ? p : [];
    } catch(e) { return []; }
  };

  const fetchData = async () => {
    try {
      const t = new Date().getTime();
      const [pRes, dRes, sRes] = await Promise.all([
        client.get(`/patients/?t=${t}`),
        client.get(`/users/min?t=${t}`),
        client.get(`/settings?t=${t}`)
      ]);
      
      setPatients(pRes.data);
      setStaff(dRes.data.filter(u => u.role === 'doctor' || u.role === 'lab')); 
      setDepartments(superParse(sRes.data.services));
      
      const allRooms = superParse(sRes.data.rooms);
      setCabinets(allRooms.filter(r => r.type && r.type.includes("Cabinet")));
      
      // 💉 Extract ONLY rooms designated for Nurses
      setNurseRooms(allRooms.filter(r => r.type === "Salle de Soins" || r.type === "Infirmerie"));
      
      const allPrices = superParse(sRes.data.prices);
      setLabCatalogue(allPrices.filter(item => item.type === 'Laboratoire'));
      setConsultationCatalogue(allPrices.filter(item => item.type === 'Consultation'));

    } catch (e) { 
      message.error("Erreur de synchronisation avec le serveur"); 
    } finally { 
      setLoading(false); 
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const onFinish = async (values) => {
    const username = localStorage.getItem('username') || "Accueil";

    try {
      // ─── 🧪 ROUTE 1: DIRECT TO LAB ───
      if (values.orientation === 'lab') {
        const labUser = staff.find(u => u.role === 'lab') || staff[0];
        if (!labUser) return message.error("Aucun personnel de laboratoire disponible.");

        await client.post('/lab/orders', {
          patient_id: values.patient_id,
          doctor_id: labUser.id, 
          doctor_name: username,
          test_name: values.lab_tests.join(', '),
          test_category: "Laboratoire (Direct)",
          clinical_notes: "Patient orienté directement depuis l'accueil.",
          urgency: "Normal"
        });

        message.success("Analyses envoyées au laboratoire !");
      } 
      
      // ─── 💉 ROUTE 2: DIRECT TO NURSE WORKSPACE (QUEUE ONLY) ───
      else if (values.orientation === 'nurse') {
        const patient = patients.find(p => p.id === values.patient_id);
        
        // 1. Send the exact task to the Nurse Checklist (Queue)
        await client.post('/nursing-tasks', {
          patient_name: `${patient.first_name} ${patient.last_name}`,
          task_description: `ACTE DIRECT: ${values.nurse_task}`,
          room_number: values.nurse_room, // Just the room, no specific bed
          status: "Pending"
        });

        // 2. Send Billing Ticket to Cashier
        await client.post('/appointments/', {
          patient_id: values.patient_id,
          // Nurse tickets should not be assigned to an arbitrary doctor.
          // Use null so these do not appear in doctor-specific queues.
          doctor_id: null,
          service: "Soins Infirmiers", 
          appointment_type: "Walk-In",
          priority: "Standard",
          scheduled_time: dayjs().format('YYYY-MM-DD HH:mm'),
          user: username
        });

        message.success("Patient ajouté à la file d'attente de la salle de soins !");
        Modal.success({ 
          title: `Ticket de Soins Créé`, 
          content: (
            <div>
              <p><b>Patient:</b> {patient.first_name} {patient.last_name}</p>
              <p><b>Acte Demandé:</b> {values.nurse_task}</p>
              <p><b>Salle:</b> {values.nurse_room}</p>
            </div>
          )
        });
      }

      // ─── 🩺 ROUTE 3: DOCTOR CONSULTATION ───
      else {
        let finalDoctorId = null;
        let scheduledTimeStr = dayjs().format('YYYY-MM-DD HH:mm');

        if (values.visit_type === 'scheduled') {
          finalDoctorId = values.doctor_id;
          scheduledTimeStr = values.scheduled_time.format('YYYY-MM-DD HH:mm');
        } else {
          const activeDoc = staff.find(d => d.room_number === values.cabinet && d.is_online);
          if (!activeDoc) return message.error("Aucun médecin en ligne dans cette salle !");
          finalDoctorId = activeDoc.id;
        }

        await client.post('/appointments/', {
          patient_id: values.patient_id,
          doctor_id: finalDoctorId,
          service: values.service,
          appointment_type: values.visit_type === 'scheduled' ? "Scheduled" : "Walk-In",
          priority: "Standard",
          scheduled_time: scheduledTimeStr,
          user: username
        });

        message.success(`Ticket Consultation Généré`);
      }

      form.resetFields(['patient_id', 'service', 'cabinet', 'doctor_id', 'scheduled_time', 'lab_tests', 'nurse_task', 'nurse_room']);
    } catch (error) { 
      message.error(error.response?.data?.detail || "Échec de la création du ticket."); 
    }
  };

  if (loading) return <div style={{textAlign: 'center', marginTop: 100}}><Spin size="large" /></div>;

  return (
    <div style={{ padding: '30px' }}>
      <Row justify="center">
        <Col span={18}>
          <Card title={<Title level={3} style={{margin: 0}}>🏥 Accueil & Triage</Title>} style={{ borderRadius: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
            <Form 
              form={form} 
              layout="vertical" 
              onFinish={onFinish}
              initialValues={{ visit_type: 'walk-in', orientation: 'consultation' }}
            >
              
              {/* --- ROUTING CONTROLS --- */}
              <Row gutter={16}>
                <Col span={10}>
                  <Form.Item name="visit_type" label="Type de Visite">
                    <Radio.Group optionType="button" buttonStyle="solid" style={{ width: '100%' }}>
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <Radio.Button value="walk-in" style={{ width: '100%', textAlign: 'center' }}><ClockCircleOutlined /> Immédiat (File)</Radio.Button>
                        <Radio.Button value="scheduled" style={{ width: '100%', textAlign: 'center' }}><CalendarOutlined /> RDV Programmé</Radio.Button>
                      </Space>
                    </Radio.Group>
                  </Form.Item>
                </Col>
                <Col span={14}>
                  <Form.Item name="orientation" label="Orientation du Patient">
                    <Radio.Group optionType="button" buttonStyle="solid" style={{ width: '100%' }}>
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <Radio.Button value="consultation" style={{ width: '100%', textAlign: 'center' }}><UserOutlined /> Consultation Médicale</Radio.Button>
                        <Radio.Button value="lab" style={{ width: '100%', textAlign: 'center' }}><ExperimentOutlined /> Analyses Laboratoire</Radio.Button>
                        <Radio.Button value="nurse" style={{ width: '100%', textAlign: 'center' }}><MedicineBoxOutlined /> Soins Infirmiers (Direct)</Radio.Button>
                      </Space>
                    </Radio.Group>
                  </Form.Item>
                </Col>
              </Row>

              <Divider />

              {/* --- PATIENT SELECTION --- */}
              <Form.Item name="patient_id" label="Sélectionner le Patient" rules={[{required: true, message: 'Requis'}]}>
                <Select showSearch placeholder="Rechercher par nom..." size="large" filterOption={(input, option) => (option?.children ?? '').toLowerCase().includes(input.toLowerCase())}>
                  {patients.map(p => <Option key={p.id} value={p.id}>{p.first_name} {p.last_name} (NSS: {p.nss || 'N/A'})</Option>)}
                </Select>
              </Form.Item>

              {/* --- DYNAMIC FIELDS BASED ON ROUTING --- */}
              <Row gutter={16}>
                
                {/* 🩺 CONSULTATION LOGIC */}
                {orientation === 'consultation' && (
                  <>
                    <Col span={12}>
                      <Form.Item name="department" label="Pôle Médical (Orientation)" rules={[{required: true, message: 'Requis'}]}>
                        <Select size="large" placeholder="Ex: Cardiologie">
                          {departments.map(d => <Option key={d.name || d} value={d.name || d}>{d.name || d}</Option>)}
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="service" label="Tarification / Acte Médical" rules={[{required: true, message: 'Requis'}]}>
                        <Select size="large" placeholder={consultationCatalogue.length > 0 ? "Choisir l'acte à facturer" : "Aucun tarif configuré"} disabled={consultationCatalogue.length === 0}>
                          {consultationCatalogue.map(c => <Option key={c.name} value={c.name}>{c.name} - <span style={{ color: '#52c41a', fontWeight: 'bold' }}>{c.amount} DA</span></Option>)}
                        </Select>
                      </Form.Item>
                    </Col>
                    {visitType === 'walk-in' && (
                      <Col span={24}>
                        <Form.Item name="cabinet" label="Cabinet Disponible" rules={[{required: true, message: 'Requis'}]}>
                          <Select placeholder="Choisir une salle active" size="large">
                            {cabinets.map(c => {
                              const doc = staff.find(d => d.room_number === (c.name || c) && d.is_online);
                              return <Option key={c.name || c} value={c.name || c} disabled={!doc}>{c.name || c} {doc ? `(Dr. ${doc.username})` : '🔴 (Hors Ligne)'}</Option>
                            })}
                          </Select>
                        </Form.Item>
                      </Col>
                    )}
                    {visitType === 'scheduled' && (
                      <>
                        <Col span={12}><Form.Item name="scheduled_time" label="Date et Heure du RDV" rules={[{required: true, message: 'Requis'}]}><DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} size="large" /></Form.Item></Col>
                        <Col span={12}><Form.Item name="doctor_id" label="Médecin Traitant" rules={[{required: true, message: 'Requis'}]}><Select showSearch size="large" placeholder="Sélectionner le médecin">{staff.filter(s => s.role === 'doctor').map(d => <Option key={d.id} value={d.id}>Dr. {d.full_name || d.username} ({d.specialty || 'Généraliste'})</Option>)}</Select></Form.Item></Col>
                      </>
                    )}
                  </>
                )}

                {/* 🧪 LABORATOIRE LOGIC */}
                {orientation === 'lab' && (
                  <Col span={24}>
                    <Form.Item name="lab_tests" label="Analyses Demandées (Tarification)" rules={[{required: true, message: 'Sélectionnez au moins une analyse'}]}>
                      <Select mode="multiple" size="large" placeholder={labCatalogue.length > 0 ? "Ex: FNS, Glycémie..." : "Aucune analyse configurée"} style={{ width: '100%' }} disabled={labCatalogue.length === 0}>
                        {labCatalogue.map(test => <Option key={test.name} value={test.name}>{test.name} - <span style={{ color: '#52c41a', fontWeight: 'bold' }}>{test.amount} DA</span></Option>)}
                      </Select>
                    </Form.Item>
                  </Col>
                )}

                {/* 💉 NURSE LOGIC (Simplified Queue) */}
                {orientation === 'nurse' && (
                  <>
                    <Col span={12}>
                      <Form.Item name="nurse_task" label="Type de Soin Infirmier (Acte)" rules={[{required: true, message: 'Requis'}]}>
                        <Select size="large" placeholder="Ex: Injection, Pansement...">
                          <Option value="Injection IM/IV">Injection IM/IV</Option>
                          <Option value="Changement de Pansement">Changement de Pansement</Option>
                          <Option value="Prise de Constantes (Tension, Glycémie)">Prise de Constantes (Tension, Glycémie)</Option>
                          <Option value="Aérosol / Nébulisation">Aérosol / Nébulisation</Option>
                          <Option value="Ablation de fils / agrafes">Ablation de fils / agrafes</Option>
                          <Option value="Autre Soin">Autre Soin</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="nurse_room" label="Sélectionner la Salle de Soins" rules={[{required: true, message: 'Requis'}]}>
                        <Select size="large" placeholder="Choisir une salle d'infirmerie">
                          {nurseRooms.map(r => <Option key={r.name} value={r.name}>{r.name}</Option>)}
                        </Select>
                      </Form.Item>
                    </Col>
                  </>
                )}

              </Row>

              <Divider />
              
              <Button type="primary" block htmlType="submit" size="large" style={{ height: 50, fontSize: 18, fontWeight: 'bold' }}>
                {visitType === 'scheduled' ? 'Confirmer le Rendez-vous' : (orientation === 'lab' ? 'Générer le Ticket Laboratoire' : (orientation === 'nurse' ? 'Envoyer en File d\'Attente Soins' : 'Générer le Ticket d\'Attente'))}
              </Button>
              
            </Form>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default FrontDeskTriage;