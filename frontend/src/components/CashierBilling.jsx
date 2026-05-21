import React, { useState, useEffect, useCallback } from 'react';
import { Card, Table, Tag, Button, Space, Typography, Row, Col, Statistic, Modal, message, Empty, Tooltip, Form, Input, InputNumber } from 'antd';
import { DollarOutlined, CreditCardOutlined, ShoppingCartOutlined, SyncOutlined, PrinterOutlined, CheckCircleOutlined, PlusOutlined } from '@ant-design/icons';
import client from '../api/client';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const Cashier = () => {
  const [pendingBills, setPendingBills] = useState([]);
  const [loading, setLoading] = useState(false);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [locallyPaidLabs, setLocallyPaidLabs] = useState([]);
  
  // Custom Facture State
  const [isCustomFactureModalOpen, setIsCustomFactureModalOpen] = useState(false);
  const [customForm] = Form.useForm();

  // Helper to safely parse JSON arrays
  const superParse = (data) => {
    try {
      let p = typeof data === 'string' ? JSON.parse(data) : data;
      if (typeof p === 'string') p = JSON.parse(p);
      return Array.isArray(p) ? p : [];
    } catch(e) { return []; }
  };

  const fetchBills = useCallback(async () => {
    setLoading(true);
    try {
      const t = new Date().getTime();
      const [apptsRes, labRes, settingsRes, logsRes] = await Promise.all([
        client.get(`/appointments/all?t=${t}`),
        client.get(`/lab/orders/today?t=${t}`),
        client.get(`/settings?t=${t}`),
        client.get(`/audit-logs?t=${t}`)
      ]);

      // 1. Fetch Dynamic Pricing Catalogue from Settings
      const rawPrices = superParse(settingsRes.data.prices);
      const priceCatalogue = {};
      rawPrices.forEach(item => {
        priceCatalogue[item.name] = Number(item.amount) || 0;
      });

      let combinedBills = [];
      let calculatedTodayRevenue = 0;
      const todayString = dayjs().format('YYYY-MM-DD');

      // 2. Map Appointments
      apptsRes.data.forEach(appt => {
        let amount = 1500; // Default fallback
        if (priceCatalogue[appt.service]) {
          amount = priceCatalogue[appt.service];
        } else if (appt.priority === "Emergency" && priceCatalogue["Urgence"]) {
          amount = priceCatalogue["Urgence"];
        } else if (priceCatalogue["Consultation Spécialisée"] && appt.service !== "Généraliste") {
          amount = priceCatalogue["Consultation Spécialisée"];
        } else if (priceCatalogue["Consultation Générale"]) {
          amount = priceCatalogue["Consultation Générale"];
        }

        // Add to persistent today's revenue if exactly Paid today!
        // To be accurate, we'll check if scheduled_time is today AND it's paid.
        if (appt.payment_status === 'Paid') {
            if(dayjs(appt.scheduled_time).format('YYYY-MM-DD') === todayString) {
               calculatedTodayRevenue += amount;
            }
        } else if (!(appt.service || '').includes('Labo:')) {
          combinedBills.push({
            key: `appt-${appt.id}`,
            id: appt.id,
            type: 'Consultation',
            patient_name: `${appt.first_name} ${appt.last_name}`,
            patient_nss: appt.nss || '—',
            description: `Visite — ${appt.service || 'Standard'}`,
            doctor_name: appt.doctor_full_name || appt.doctor_username,
            amount: amount,
            date: appt.scheduled_time,
            ticket_number: appt.ticket_number
          });
        }
      });

      // Parse paid labs from logs first
      const paidLabIds = new Set(locallyPaidLabs);
      logsRes.data.forEach(log => {
        if (log.action === 'LAB_PAYMENT_RECEIVED') {
           const idMatch = log.details.match(/Lab ID:\s*(\d+)/);
           if (idMatch) paidLabIds.add(parseInt(idMatch[1], 10));
        }
      });

      // 3. Lab Orders
      labRes.data.forEach(order => {
        const tests = (order.test_name || '').split(',').map(t => t.trim());
        let total = 0;
        tests.forEach(testName => { 
          total += priceCatalogue[testName] || 1000;
        });

        // Show if not paid (we ignore the status because lab tech might complete it before payment)
        if (!paidLabIds.has(order.id)) {
          combinedBills.push({
            key: `lab-${order.id}`,
            id: order.id,
            type: 'Laboratoire',
            patient_name: order.patient_name,
            patient_nss: order.patient_nss,
            description: `Analyses: ${order.test_name}`,
            doctor_name: order.doctor_name || 'Accueil',
            amount: total,
            date: order.ordered_at,
            ticket_number: `LAB-${order.id}`
          });
        }
      });

      // 4. Calculate Custom Factures & Lab Payments from AuditLogs!
      logsRes.data.forEach(log => {
        // Only look at today's logs
        if (dayjs(log.timestamp).format('YYYY-MM-DD') === todayString) {
           if (log.action === 'CUSTOM_PAYMENT_RECEIVED' || log.action === 'LAB_PAYMENT_RECEIVED') {
              // Extract amount from details "Amount: 5000"
              const match = log.details.match(/Amount:\s*(\d+)/);
              if (match) {
                 calculatedTodayRevenue += parseInt(match[1], 10);
              }
           }
        }
      });

      setTotalRevenue(calculatedTodayRevenue);

      // Sort by newest first
      combinedBills.sort((a, b) => new Date(b.date) - new Date(a.date));
      setPendingBills(combinedBills);
    } catch (e) {
      console.error(e);
      message.error("Erreur de chargement des factures.");
    } finally {
      setLoading(false);
    }
  }, [locallyPaidLabs]);

  useEffect(() => {
    fetchBills();
  }, [fetchBills]);

  const printReceipt = (bill) => {
    const win = window.open('', '_blank');
    win.document.write(`
      <html><head><title>Reçu de Paiement</title>
      <style>
        body { font-family: 'Courier New', Courier, monospace; padding: 20px; color: #000; width: 300px; margin: 0 auto; }
        .text-center { text-align: center; }
        .divider { border-bottom: 1px dashed #000; margin: 10px 0; }
        .bold { font-weight: bold; }
        .flex-between { display: flex; justify-content: space-between; }
      </style></head>
      <body>
        <div class="text-center">
          <h2 style="margin: 0;">CLINIQUE SMART</h2>
          <p style="margin: 5px 0; font-size: 12px;">Reçu de Caisse</p>
        </div>
        <div class="divider"></div>
        <div class="flex-between" style="font-size: 12px;">
          <span>Date:</span>
          <span>${dayjs().format('DD/MM/YYYY HH:mm')}</span>
        </div>
        <div class="flex-between" style="font-size: 12px;">
          <span>Ticket:</span>
          <span>${bill.ticket_number || 'N/A'}</span>
        </div>
        <div class="divider"></div>
        <p class="bold" style="font-size: 14px; margin: 5px 0;">Patient:</p>
        <p style="margin: 0 0 10px 0; font-size: 14px;">${bill.patient_name}<br/><span style="font-size: 12px;">NSS: ${bill.patient_nss}</span></p>
        
        <p class="bold" style="font-size: 14px; margin: 5px 0;">Désignation:</p>
        <p style="margin: 0 0 10px 0; font-size: 12px;">${bill.description}</p>
        
        <div class="divider"></div>
        <div class="flex-between bold" style="font-size: 16px;">
          <span>TOTAL:</span>
          <span>${bill.amount} DA</span>
        </div>
        <div class="divider"></div>
        <div class="text-center" style="font-size: 11px; margin-top: 15px;">
          <p>Merci de votre confiance.</p>
          <p>Conservez ce reçu.</p>
        </div>
        <script>window.print(); window.close();</script>
      </body></html>
    `);
    win.document.close();
  };

  const handleProcessPayment = async (bill) => {
    Modal.confirm({
      title: '💵 Confirmer l\'encaissement',
      content: (
        <div>
          <p>Valider le paiement de <b>{bill.amount} DA</b> pour <b>{bill.patient_name}</b> ?</p>
          <p style={{ fontSize: 12, color: 'gray' }}>Une trace sera automatiquement ajoutée au journal d'audit.</p>
        </div>
      ),
      okText: 'Encaisser',
      cancelText: 'Annuler',
      okButtonProps: { style: { background: '#52c41a', borderColor: '#52c41a' } },
      onOk: async () => {
        try {
          if (bill.type === 'Consultation') {
            await client.patch(`/appointments/${bill.id}/status`, { payment_status: 'Paid' });
          } else {
            setLocallyPaidLabs(prev => [...prev, bill.id]);
            await client.post('/audit-logs', { 
               user: 'Caisse', 
               action: 'LAB_PAYMENT_RECEIVED', 
               details: `Amount: ${bill.amount} DA - Lab ID: ${bill.id}` 
            });
          }

          setTotalRevenue(prev => prev + bill.amount);
          message.success(`Paiement de ${bill.amount} DA reçu avec succès !`);
          
          Modal.confirm({
            title: '🖨️ Imprimer le reçu ?',
            icon: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
            content: 'Voulez-vous imprimer le reçu pour le patient ?',
            okText: 'Oui, Imprimer',
            cancelText: 'Non',
            onOk: () => printReceipt(bill)
          });

          fetchBills();
        } catch (error) {
          message.error("Échec de la transaction.");
        }
      }
    });
  };

  const handleCancelBill = async (bill) => {
    Modal.confirm({
      title: '🛑 Annuler la facture',
      content: (
        <div>
          <p>Êtes-vous sûr de vouloir annuler la facture de <b>{bill.patient_name}</b> pour <b>{bill.amount} DA</b> ?</p>
        </div>
      ),
      okText: 'Oui, Annuler',
      cancelText: 'Retour',
      okType: 'danger',
      onOk: async () => {
        try {
          if (bill.type === 'Consultation') {
            await client.patch(`/appointments/${bill.id}/status`, { payment_status: 'Cancelled' });
          } else {
            // Option to cancel test or hide it from the list locally if backend does not support Cancelling lab orders yet.
            setLocallyPaidLabs(prev => [...prev, bill.id]); 
          }
          message.success("Facture annulée avec succès.");
          fetchBills();
        } catch (error) {
          message.error("Échec de l'annulation de la facture.");
        }
      }
    });
  };

  const handleCreateCustomFacture = async (values) => {
    const newBill = {
      key: `custom-${Date.now()}`,
      id: `custom-${Date.now()}`,
      type: 'Facture Libre',
      patient_name: values.patient_name,
      patient_nss: values.nss || '—',
      description: values.description,
      doctor_name: 'Caisse',
      amount: values.amount,
      date: new Date().toISOString(),
      ticket_number: `CUS-${Date.now().toString().slice(-6)}`
    };

    // Immediatley pay it or just add to pending? Adding to pending might be confusing because there's no backend for custom bills after a reload. 
    // It's better to immediately print and add to session revenue.
    await client.post('/audit-logs', { 
       user: 'Caisse', 
       action: 'CUSTOM_PAYMENT_RECEIVED', 
       details: `Amount: ${newBill.amount} DA - Custom Bill for ${newBill.patient_name} - Motif: ${newBill.description}` 
    });

    setTotalRevenue(prev => prev + newBill.amount);
    message.success(`Facture libre de ${newBill.amount} DA créée et validée avec succès !`);
    
    // Auto print
    printReceipt(newBill);
    
    setIsCustomFactureModalOpen(false);
    customForm.resetFields();
  };

  const columns = [
    { 
      title: 'Type', 
      dataIndex: 'type', 
      key: 'type', 
      render: (t) => <Tag color={t === 'Laboratoire' ? 'purple' : 'blue'} style={{ fontWeight: 'bold' }}>{t}</Tag>,
      width: 120
    },
    { 
      title: 'Patient', 
      key: 'patient', 
      render: (_, r) => (
        <div>
          <Text strong style={{ fontSize: 15 }}>{r.patient_name}</Text><br/>
          <Text type="secondary" style={{ fontSize: 12 }}>NSS: {r.patient_nss}</Text>
        </div>
      )
    },
    { 
      title: 'Détails Facturation', 
      dataIndex: 'description', 
      key: 'desc',
      render: (desc, r) => (
        <div>
          <Text>{desc}</Text><br/>
          <Text type="secondary" style={{ fontSize: 11 }}>Par: Dr. {r.doctor_name}</Text>
        </div>
      )
    },
    { 
      title: 'Heure', 
      dataIndex: 'date', 
      key: 'date', 
      render: (d) => <Text strong>{dayjs(d).format('HH:mm')}</Text>,
      width: 100
    },
    { 
      title: 'Montant', 
      dataIndex: 'amount', 
      key: 'amount', 
      render: (a) => <Text strong style={{ color: '#52c41a', fontSize: 16 }}>{a} DA</Text>,
      width: 120
    },
    { 
      title: 'Action', 
      key: 'action', 
      align: 'center', 
      render: (_, r) => (
        <Space>
          <Button 
            type="primary" 
            icon={<CreditCardOutlined />} 
            onClick={() => handleProcessPayment(r)} 
            style={{ background: '#52c41a', borderColor: '#52c41a', fontWeight: 600, borderRadius: 6 }}
          >
            Encaisser
          </Button>
          <Tooltip title="Annuler le paiement">
            <Button 
              danger 
              onClick={() => handleCancelBill(r)} 
              style={{ borderRadius: 6 }}
            >
              Annuler
            </Button>
          </Tooltip>
          <Tooltip title="Aperçu Reçu">
            <Button icon={<PrinterOutlined />} onClick={() => printReceipt(r)} style={{ borderRadius: 6 }} />
          </Tooltip>
        </Space>
      ),
      width: 250
    }
  ];

  return (
    <div style={{ padding: '24px', background: '#f5f7fa', minHeight: '100vh', animation: 'fadeIn 0.4s' }}>
      
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Title level={2} style={{ margin: 0, color: '#141414' }}>
            <DollarOutlined style={{ color: '#52c41a', marginRight: 12 }} /> 
            Caisse & Facturation
          </Title>
          <Text type="secondary" style={{ fontSize: 15 }}>Gérez les encaissements des consultations et des actes de laboratoire.</Text>
        </div>
        <Space>
          <Button 
            type="primary" 
            icon={<PlusOutlined />} 
            onClick={() => setIsCustomFactureModalOpen(true)} 
            size="large" 
            style={{ borderRadius: 8, background: '#1890ff', borderColor: '#1890ff' }}
          >
            Facture Libre
          </Button>
          <Button icon={<SyncOutlined />} onClick={fetchBills} loading={loading} size="large" style={{ borderRadius: 8 }}>
            Actualiser
          </Button>
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card style={{ borderRadius: 12, background: '#f6ffed', borderLeft: '5px solid #52c41a', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Statistic 
              title={<Text style={{ color: '#237804', fontWeight: 600 }}>Recettes du Jour (Session)</Text>} 
              value={totalRevenue} 
              suffix="DA" 
              prefix={<DollarOutlined />}
              valueStyle={{ color: '#52c41a', fontWeight: 800, fontSize: 32 }} 
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card style={{ borderRadius: 12, background: '#fff7e6', borderLeft: '5px solid #fa8c16', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Statistic 
              title={<Text style={{ color: '#874d00', fontWeight: 600 }}>Factures en Attente</Text>} 
              value={pendingBills.length} 
              prefix={<ShoppingCartOutlined style={{ color: '#fa8c16' }} />} 
              valueStyle={{ color: '#fa8c16', fontWeight: 800, fontSize: 32 }} 
            />
          </Card>
        </Col>
      </Row>

      <Card title={<span style={{ fontWeight: 700 }}>Transactions en attente de règlement</span>} style={{ borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }} bodyStyle={{ padding: 0 }}>
        <Table 
          columns={columns} 
          dataSource={pendingBills} 
          loading={loading} 
          bordered 
          size="middle" 
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: <Empty description="Aucun paiement en attente. Tout est à jour !" /> }} 
        />
      </Card>

      {/* Modal Facture Libre */}
      <Modal 
        title={<Space><DollarOutlined style={{ color: '#52c41a' }}/> Créer une Facture Libre</Space>}
        open={isCustomFactureModalOpen}
        onCancel={() => { setIsCustomFactureModalOpen(false); customForm.resetFields(); }}
        onOk={() => customForm.submit()}
        okText="Valider & Imprimer"
        cancelText="Annuler"
      >
        <Form form={customForm} layout="vertical" onFinish={handleCreateCustomFacture}>
          <Form.Item name="patient_name" label="Nom du Patient" rules={[{ required: true, message: 'Veuillez saisir le nom du patient' }]}>
            <Input placeholder="Ex: Ali Benali" size="large" />
          </Form.Item>
          <Form.Item name="nss" label="NSS (Optionnel)">
            <Input placeholder="N° de Sécurité Sociale" size="large" />
          </Form.Item>
          <Form.Item name="description" label="Désignation / Motif" rules={[{ required: true, message: 'Veuillez saisir la description de la facture' }]}>
            <Input.TextArea placeholder="Ex: Vente de médicaments, Services divers..." rows={2} size="large" />
          </Form.Item>
          <Form.Item name="amount" label="Montant (DA)" rules={[{ required: true, message: 'Veuillez saisir le montant' }]}>
            <InputNumber placeholder="0" min={1} style={{ width: '100%' }} size="large" addonAfter="DA" />
          </Form.Item>
        </Form>
      </Modal>

    </div>
  );
};

export default Cashier;

