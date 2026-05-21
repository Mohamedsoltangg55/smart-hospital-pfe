import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Tag, Button, Typography, Space, Badge, Row, Col,
  Modal, Form, Input, Select, message, Empty, Statistic, Tooltip
} from 'antd';
import {
  ExperimentOutlined, CheckCircleOutlined, ClockCircleOutlined,
  SearchOutlined, PrinterOutlined, PlayCircleOutlined, ThunderboltOutlined, SyncOutlined
} from '@ant-design/icons';
import client from '../api/client';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const URGENCY = {
  STAT:   { color: '#ff4d4f', bg: '#fff1f0', border: '#ffccc7', label: '🚨 STAT'   },
  Urgent: { color: '#fa8c16', bg: '#fff7e6', border: '#ffd591', label: '⚡ Urgent' },
  Normal: { color: '#52c41a', bg: '#f6ffed', border: '#b7eb8f', label: '✅ Normal' },
};

// Matched exactly to your backend LAB_CATALOGUE
const RESULT_TEMPLATES = {
  'NFS (Numération Formule Sanguine)': [
    { parameter: 'Leucocytes (GB)',   unit: '10³/μL', ref_min: '4.0',  ref_max: '10.0' },
    { parameter: 'Érythrocytes (GR)', unit: '10⁶/μL', ref_min: '4.5',  ref_max: '5.5'  },
    { parameter: 'Hémoglobine (Hb)', unit: 'g/dL',   ref_min: '12.0', ref_max: '17.0' },
    { parameter: 'Hématocrite (Hte)',unit: '%',       ref_min: '37',   ref_max: '50'   },
    { parameter: 'Plaquettes',       unit: '10³/μL',  ref_min: '150',  ref_max: '400'  },
  ],
  'Glycémie à jeun': [
    { parameter: 'Glycémie', unit: 'g/L', ref_min: '0.70', ref_max: '1.10' },
  ],
  'Créatinine + Urée': [
    { parameter: 'Créatinine', unit: 'mg/L', ref_min: '6',  ref_max: '13' },
    { parameter: 'Urée',       unit: 'g/L',  ref_min: '0.15', ref_max: '0.45' },
  ],
  'Bilan lipidique (Cholestérol/TG/HDL/LDL)': [
    { parameter: 'Cholestérol total', unit: 'g/L', ref_min: '1.5', ref_max: '2.0' },
    { parameter: 'Triglycérides',     unit: 'g/L', ref_min: '0.5', ref_max: '1.5' },
  ],
  'Bilan hépatique (ASAT/ALAT/GGT/PAL)': [
    { parameter: 'ASAT (TGO)', unit: 'UI/L', ref_min: '0', ref_max: '40' },
    { parameter: 'ALAT (TGP)', unit: 'UI/L', ref_min: '0', ref_max: '41' },
  ]
};

const computeFlag = (value, refMin, refMax) => {
  const v = parseFloat(value);
  if (isNaN(v)) return 'N';
  const lo = parseFloat(refMin);
  const hi = parseFloat(refMax);
  if (!isNaN(lo) && v < lo) return v < lo * 0.7 ? '!' : 'L';
  if (!isNaN(hi) && v > hi) return v > hi * 1.3 ? '!' : 'H';
  return 'N';
};

const Laboratory = () => {
  const [orders,      setOrders]      = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [activeOrder, setActiveOrder] = useState(null);
  const [rows,        setRows]        = useState([]);     
  const [modalOpen,   setModalOpen]   = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  const [searchText,  setSearchText]  = useState('');

  const techName = localStorage.getItem('username') || 'Laboratoire';

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get(`/lab/orders/pending?t=${new Date().getTime()}`);
      setOrders(res.data);
    } catch (error) {
      console.error(error);
      message.error('Impossible de charger la file d\'attente du laboratoire.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 8000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  const openResultModal = async (order) => {
    setActiveOrder(order);
    
    try {
      await client.patch(`/lab/orders/${order.id}/start`);
      fetchOrders(); 
    } catch (error) { 
      console.warn("Failed to mark in progress", error); 
    }

    const requestedTests = (order.test_name || '').split(',').map(t => t.trim());
    let combinedTemplate = [];
    
    requestedTests.forEach(reqTest => {
      const template = RESULT_TEMPLATES[reqTest];
      if (template) {
        combinedTemplate = [...combinedTemplate, ...template];
      }
    });

    if (combinedTemplate.length === 0) {
      combinedTemplate = [{ parameter: 'Résultat Test', unit: '', ref_min: '', ref_max: '' }];
    }

    setRows(combinedTemplate.map(t => ({ ...t, value: '', flag: 'N' })));
    setModalOpen(true);
  };

  const updateRow = (idx, field, val) => {
    setRows(prev => {
      const updated = prev.map((r, i) => (i === idx ? { ...r, [field]: val } : r));
      if (field === 'value') {
        const row = updated[idx];
        updated[idx] = { ...row, flag: computeFlag(val, row.ref_min, row.ref_max) };
      }
      return updated;
    });
  };

  const addRow = () => setRows(prev => [...prev, { parameter: '', value: '', unit: '', ref_min: '', ref_max: '', flag: 'N' }]);
  const removeRow = (idx) => setRows(prev => prev.filter((_, i) => i !== idx));

  const handleSubmit = async () => {
    if (rows.some(r => !r.parameter || r.value === '')) {
      return message.warning('Veuillez remplir tous les paramètres et valeurs avant de soumettre.');
    }
    setSubmitting(true);
    try {
      await client.post(`/lab/orders/${activeOrder.id}/results`, {
        lab_tech_name: techName,
        results: rows
      });

      message.success('Résultats validés et envoyés au dossier du patient !');
      setModalOpen(false);
      fetchOrders();
    } catch (error) {
      console.error(error.response);
      message.error("Erreur lors de l'enregistrement des résultats.");
    } finally {
      setSubmitting(false);
    }
  };

  const printReport = () => {
    const tableRows = rows.map(row => `
      <tr>
        <td style="padding:10px 12px; border-bottom:1px solid #e8e8e8; font-size:14px;">${row.parameter}</td>
        <td style="padding:10px 12px; border-bottom:1px solid #e8e8e8; font-weight:bold; font-size:14px;
            color:${row.flag === 'H' || row.flag === '!' ? '#cf1322' : row.flag === 'L' ? '#1890ff' : '#000'}">
          ${row.value}
        </td>
        <td style="padding:10px 12px; border-bottom:1px solid #e8e8e8; font-size:14px;">${row.unit || ''}</td>
        <td style="padding:10px 12px; border-bottom:1px solid #e8e8e8; color:#888; font-size:14px;">
          ${row.ref_min || ''} – ${row.ref_max || ''}
        </td>
        <td style="padding:10px 12px; border-bottom:1px solid #e8e8e8; font-size:14px;">
          ${row.flag === 'H' ? '<span style="color:#cf1322">↑ Élevé</span>' : row.flag === 'L' ? '<span style="color:#1890ff">↓ Bas</span>' : row.flag === '!' ? '<span style="color:#cf1322; font-weight:bold;">⚠ CRITIQUE</span>' : '<span style="color:#52c41a">Normal</span>'}
        </td>
      </tr>`).join('');

    const win = window.open('', '_blank');
    win.document.write(`
      <html><head><title>Compte-Rendu de Laboratoire - ${activeOrder?.patient_name}</title>
      <style>
        body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 40px; color: #1a1a1a; max-width: 900px; margin: 0 auto; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #722ed1; padding-bottom: 20px; margin-bottom: 30px; }
        .info-box { background: #f9f0ff; border: 1px solid #d3adf7; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
        th { background: #f0f2f5; font-weight: 600; color: #333; text-transform: uppercase; font-size: 12px; letter-spacing: 0.5px; }
      </style></head>
      <body>
        <div class="header">
          <div>
            <h1 style="color:#722ed1; margin:0; font-size: 28px;">🏥 Smart Hospital</h1>
            <p style="margin:5px 0 0 0; color:#555; font-size: 14px;">Laboratoire d'Analyses de Biologie Médicale</p>
          </div>
          <div style="text-align: right;">
            <h2 style="margin: 0; color: #333;">RÉSULTATS D'ANALYSES</h2>
            <p style="margin: 5px 0 0 0; color: #888; font-size: 12px;">Édité le ${dayjs().format('DD/MM/YYYY à HH:mm')}</p>
          </div>
        </div>
        
        <div class="info-box">
          <table style="margin: 0;">
            <tr>
              <td style="width: 50%;"><strong>Patient :</strong> <span style="font-size: 16px;">${activeOrder?.patient_name}</span></td>
              <td><strong>Docteur Prescripteur :</strong> Dr. ${activeOrder?.doctor_name}</td>
            </tr>
            <tr>
              <td><strong>NSS :</strong> ${activeOrder?.patient_nss || 'Non renseigné'}</td>
              <td><strong>Technicien Biologiste :</strong> ${techName}</td>
            </tr>
            <tr>
              <td><strong>Date de Prélèvement :</strong> ${dayjs(activeOrder?.ordered_at).format('DD/MM/YYYY HH:mm')}</td>
              <td><strong>Numéro de Dossier :</strong> LAB-${activeOrder?.id}</td>
            </tr>
          </table>
        </div>

        <h3 style="color: #333; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 5px;">Examens réalisés : <span style="color: #722ed1;">${activeOrder?.test_name}</span></h3>

        <table>
          <thead>
            <tr>
              <th style="padding:12px; text-align:left; border-radius: 6px 0 0 0;">Paramètre</th>
              <th style="padding:12px; text-align:left;">Résultat</th>
              <th style="padding:12px; text-align:left;">Unité</th>
              <th style="padding:12px; text-align:left;">Valeurs de Référence</th>
              <th style="padding:12px; text-align:left; border-radius: 0 6px 0 0;">Interprétation</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>

        <div style="margin-top: 60px; text-align: right; padding-right: 40px;">
          <p style="margin-bottom: 60px;"><strong>Signature du Biologiste :</strong></p>
          <p style="color: #722ed1; font-weight: bold;">${techName}</p>
        </div>
      </body></html>`);
    win.document.close();
    setTimeout(() => { win.print(); win.close(); }, 500);
  };

  const columns = [
    {
      title: 'Priorité',
      dataIndex: 'urgency',
      key: 'urgency',
      width: 120,
      render: (u) => {
        const cfg = URGENCY[u] || URGENCY.Normal;
        return <Tag style={{ backgroundColor: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, fontWeight: 700, padding: '4px 8px', borderRadius: '4px' }}>{cfg.label}</Tag>;
      },
      sorter: (a, b) => {
        const priority = { 'STAT': 3, 'Urgent': 2, 'Normal': 1 };
        return (priority[b.urgency] || 1) - (priority[a.urgency] || 1);
      },
      defaultSortOrder: 'descend'
    },
    {
      title: 'Patient',
      key: 'patient',
      render: (_, r) => (
        <div>
          <Text strong style={{ fontSize: '15px' }}>{r.patient_name}</Text><br />
          <Text type="secondary" style={{ fontSize: 12 }}>NSS: {r.patient_nss || '—'}</Text>
        </div>
      ),
    },
    {
      title: 'Analyses Demandées',
      key: 'test',
      render: (_, r) => (
        <Space>
          <ExperimentOutlined style={{ color: '#722ed1' }} />
          <Text strong>{r.test_name}</Text>
        </Space>
      ),
    },
    {
      title: 'Prescrit Par',
      dataIndex: 'doctor_name',
      key: 'doctor_name',
      render: (d) => <Text type="secondary">Dr. {d}</Text>
    },
    {
      title: 'Heure',
      dataIndex: 'ordered_at',
      key: 'ordered_at',
      render: (t) => (
        <Space direction="vertical" size={0}>
          <Text strong>{dayjs(t).format('HH:mm')}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(t).format('DD/MM/YYYY')}</Text>
        </Space>
      ),
    },
    {
      title: 'Statut',
      dataIndex: 'status',
      key: 'status',
      render: (s) => s === 'In Progress' ? <Badge status="processing" text={<Text style={{ color: '#1890ff', fontWeight: 600 }}>En cours</Text>} /> : <Badge status="warning" text="En attente" />
    },
    {
      title: 'Action',
      key: 'action',
      align: 'center',
      render: (_, r) => (
        <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => openResultModal(r)} style={{ borderRadius: 6, fontWeight: 600, background: '#722ed1', borderColor: '#722ed1' }}>
          Traiter l'échantillon
        </Button>
      ),
    },
  ];

  const filteredOrders = orders.filter(o => 
    o.patient_name.toLowerCase().includes(searchText.toLowerCase()) || 
    (o.test_name && o.test_name.toLowerCase().includes(searchText.toLowerCase()))
  );

  return (
    <div style={{ padding: '24px', background: '#f5f7fa', minHeight: '100vh', animation: 'fadeIn 0.4s' }}>
      
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Title level={2} style={{ margin: 0, color: '#141414' }}>
            <ExperimentOutlined style={{ color: '#722ed1', marginRight: 12 }} /> 
            Plateau Technique (Laboratoire)
          </Title>
          <Text type="secondary" style={{ fontSize: 15 }}>Gérez les prélèvements et saisissez les résultats des analyses.</Text>
        </div>
        <Button icon={<SyncOutlined />} onClick={fetchOrders} loading={loading} size="large" style={{ borderRadius: 8 }}>
          Actualiser
        </Button>
      </div>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card style={{ borderRadius: 12, background: '#f9f0ff', borderLeft: '5px solid #722ed1', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Statistic 
              title={<Text style={{ color: '#531dab', fontWeight: 600 }}>Total en attente</Text>} 
              value={orders.length} 
              prefix={<ExperimentOutlined style={{ color: '#722ed1' }} />} 
              valueStyle={{ color: '#722ed1', fontWeight: 800, fontSize: 32 }} 
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card style={{ borderRadius: 12, background: '#fff1f0', borderLeft: '5px solid #ff4d4f', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Statistic 
              title={<Text style={{ color: '#a8071a', fontWeight: 600 }}>Urgences STAT</Text>} 
              value={orders.filter(o => o.urgency === 'STAT').length} 
              prefix={<ThunderboltOutlined style={{ color: '#ff4d4f' }} />} 
              valueStyle={{ color: '#ff4d4f', fontWeight: 800, fontSize: 32 }} 
            />
          </Card>
        </Col>
      </Row>

      <Card 
        title={<span style={{ fontWeight: 700 }}>File d'attente des Prélèvements</span>} 
        extra={
          <Input 
            placeholder="Rechercher un patient ou un test..." 
            prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />} 
            onChange={e => setSearchText(e.target.value)}
            style={{ width: 300, borderRadius: 8 }}
          />
        }
        style={{ borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }} 
        bodyStyle={{ padding: 0 }}
      >
        <Table 
          columns={columns} 
          dataSource={filteredOrders} 
          rowKey="id" 
          loading={loading} 
          pagination={{ pageSize: 10 }} 
          rowClassName={(r) => r.urgency === 'STAT' ? 'lab-row-stat' : r.urgency === 'Urgent' ? 'lab-row-urgent' : ''} 
          size="middle" 
          locale={{ emptyText: <Empty description="Aucune analyse en attente. Excellent travail !" /> }}
        />
        <style>{`.lab-row-stat td { background: #fff1f0 !important; } .lab-row-urgent td { background: #fffbe6 !important; }`}</style>
      </Card>

      <Modal 
        title={
          <Space style={{ width: '100%', justifyContent: 'space-between', paddingRight: 24 }}>
            <span><ExperimentOutlined style={{ color: '#722ed1', marginRight: 8 }} /> Saisie des résultats biométriques</span>
            <Button icon={<PrinterOutlined />} onClick={printReport} style={{ borderRadius: 6 }}>Aperçu Impression</Button>
          </Space>
        } 
        open={modalOpen} 
        onCancel={() => setModalOpen(false)} 
        onOk={handleSubmit} 
        okText="Valider & Archiver (Envoyer au Médecin)" 
        cancelText="Fermer" 
        width={950} 
        okButtonProps={{ loading: submitting, style: { background: '#722ed1', borderColor: '#722ed1', fontWeight: 600, borderRadius: 6 } }}
      >
        {activeOrder && (
          <>
            <div style={{ background: '#f9f0ff', border: '1px solid #d3adf7', borderRadius: 8, padding: '16px', marginBottom: 20, display: 'flex', justifyContent: 'space-between' }}>
              <div><Text type="secondary" style={{ fontSize: 12 }}>PATIENT</Text><br /><Text strong style={{ fontSize: 16 }}>{activeOrder.patient_name}</Text></div>
              <div><Text type="secondary" style={{ fontSize: 12 }}>DOCTEUR</Text><br /><Text strong>Dr. {activeOrder.doctor_name}</Text></div>
              <div><Text type="secondary" style={{ fontSize: 12 }}>ANALYSES DEMANDÉES</Text><br /><Text strong style={{ color: '#722ed1' }}>{activeOrder.test_name}</Text></div>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 1fr 1fr 1fr 90px 40px', gap: '8px', marginBottom: 12, paddingLeft: 8 }}>
              {['Paramètre / Examen', 'Valeur Mesurée', 'Unité', 'Réf. min', 'Réf. max', 'Interprétation', ''].map(h => <Text key={h} type="secondary" style={{ fontSize: 12, fontWeight: 700 }}>{h}</Text>)}
            </div>
            
            <div style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '8px' }}>
              {rows.map((row, idx) => (
                <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 1fr 1fr 1fr 90px 40px', gap: '8px', marginBottom: 10, padding: '10px 8px', borderRadius: 8, background: row.flag === '!' ? '#fff1f0' : row.flag === 'H' || row.flag === 'L' ? '#fffbe6' : '#fafafa', border: '1px solid #f0f0f0', alignItems: 'center' }}>
                  <Input value={row.parameter} onChange={e => updateRow(idx, 'parameter', e.target.value)} placeholder="Nom du paramètre" />
                  <Input value={row.value} onChange={e => updateRow(idx, 'value', e.target.value)} placeholder="Résultat" style={{ fontWeight: 700, borderColor: row.flag !== 'N' ? '#d9363e' : undefined }} />
                  <Input value={row.unit} onChange={e => updateRow(idx, 'unit', e.target.value)} placeholder="Ex: g/L" />
                  <Input value={row.ref_min} onChange={e => updateRow(idx, 'ref_min', e.target.value)} />
                  <Input value={row.ref_max} onChange={e => updateRow(idx, 'ref_max', e.target.value)} />
                  <Select value={row.flag} onChange={v => updateRow(idx, 'flag', v)} style={{ width: '100%' }}>
                    <Select.Option value="N"><Tag color="default" style={{ margin: 0, display: 'block', textAlign: 'center' }}>Norm.</Tag></Select.Option>
                    <Select.Option value="H"><Tag color="red" style={{ margin: 0, display: 'block', textAlign: 'center' }}>↑ Haut</Tag></Select.Option>
                    <Select.Option value="L"><Tag color="blue" style={{ margin: 0, display: 'block', textAlign: 'center' }}>↓ Bas</Tag></Select.Option>
                    <Select.Option value="!"><Tag color="magenta" style={{ margin: 0, display: 'block', textAlign: 'center' }}>⚠ CRIT.</Tag></Select.Option>
                  </Select>
                  <Tooltip title="Supprimer la ligne">
                    <Button danger type="text" disabled={rows.length === 1} onClick={() => removeRow(idx)}>✕</Button>
                  </Tooltip>
                </div>
              ))}
            </div>
            
            <Button type="dashed" block onClick={addRow} style={{ marginTop: 16, borderColor: '#722ed1', color: '#722ed1', height: 40, borderRadius: 8 }}>
              + Ajouter un paramètre manuel
            </Button>
          </>
        )}
      </Modal>
    </div>
  );
};

export default Laboratory;