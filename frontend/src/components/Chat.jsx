import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, Sparkles, User, Bot, FileText, Filter, 
  Trash2, HelpCircle, Loader, MessageSquare, 
  ChevronRight, Compass, ShieldAlert, Cpu
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Chat({ onSelectDoc }) {
  const { currentUser } = useAuth();
  
  // Estados para el chatbot
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      content: '¡Hola! Bienvenido a **Anla-Chat**, tu asistente de análisis documental inteligente. Puedo buscar, leer y extraer respuestas exactas en base a todo el corpus de resoluciones, licencias, autos e informes ambientales que han sido analizados.\n\nEscribe tu pregunta abajo. Opcionalmente, puedes usar la barra superior de **Filtros** para restringir mi búsqueda semántica a un sector, empresa o territorio específico.',
      citations: [],
      timestamp: new Date().toISOString()
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchingDoc, setFetchingDoc] = useState(false);

  // Estados para Filtros
  const [sectors, setSectors] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [territories, setTerritories] = useState([]);
  
  const [selectedSector, setSelectedSector] = useState('TODOS');
  const [selectedCompany, setSelectedCompany] = useState('TODAS');
  const [selectedTerritory, setSelectedTerritory] = useState('TODAS');

  const messagesEndRef = useRef(null);

  // Cargar Filtros dinámicos de la base de datos
  useEffect(() => {
    async function loadFilters() {
      try {
        const idToken = await currentUser.getIdToken();
        const res = await fetch('/api/chat/filters', {
          headers: {
            'Authorization': `Bearer ${idToken}`
          }
        });
        if (res.ok) {
          const data = await res.json();
          setSectors(data.sectors || []);
          setCompanies(data.companies || []);
          setTerritories(data.territories || []);
        }
      } catch (err) {
        console.error('Error al cargar filtros del chat:', err);
      }
    }
    loadFilters();
  }, [currentUser]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Manejo de envío
  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessageText = input.trim();
    setInput('');
    setLoading(true);

    const userMsg = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: userMessageText,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMsg]);

    try {
      const idToken = await currentUser.getIdToken();
      
      const filters = {};
      if (selectedSector !== 'TODOS') filters.sector = selectedSector;
      if (selectedCompany !== 'TODAS') filters.company = selectedCompany;
      if (selectedTerritory !== 'TODAS') filters.region = selectedTerritory;

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          message: userMessageText,
          filters: Object.keys(filters).length > 0 ? filters : null
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Fallo al obtener respuesta de la IA.');
      }

      const data = await res.json();

      const aiMsg = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: data.response,
        citations: data.citations || [],
        iaMetadata: data.iaMetadata || null,
        timestamp: new Date().toISOString()
      };

      setMessages(prev => [...prev, aiMsg]);
    } catch (err) {
      console.error('Error en consulta de chat con IA:', err);
      const errMsg = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `⚠️ Lo siento, ocurrió un error inesperado al procesar tu pregunta:\n\n*${err.message || 'Error de conexión con el servidor.'}*\n\nPor favor, verifica tus filtros e intenta de nuevo.`,
        error: true,
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  };

  // Limpiar chat
  const clearChat = () => {
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: 'Chat reiniciado. ¿En qué expediente o trámite ambiental de la ANLA te puedo colaborar hoy?',
        citations: [],
        timestamp: new Date().toISOString()
      }
    ]);
  };

  // Clic en Citación: Recupera documento completo y lo abre en el visor global
  const handleCitationClick = async (docId, fileName) => {
    setFetchingDoc(true);
    try {
      const idToken = await currentUser.getIdToken();
      const res = await fetch(`/api/documents/${docId}`, {
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });
      
      if (!res.ok) {
        throw new Error('No se pudo encontrar el expediente completo de este documento.');
      }
      
      const doc = await res.json();
      onSelectDoc(doc); // Cambiar el estado en App.jsx para abrir DocViewer
    } catch (err) {
      alert(`No se pudo abrir el visor: ${err.message || 'El documento ya no está disponible en la base de datos.'}`);
    } finally {
      setFetchingDoc(false);
    }
  };

  // Helper para renderizar texto formateando negritas e inline citation badges
  const renderMessageContent = (text) => {
    if (!text) return null;

    // Primero formatear negritas básicas (**texto**)
    const boldRegex = /\*\*([^*]+)\*\*/g;
    let formattedText = text;
    
    // Regex de citas [Doc:id|name]
    const citationRegex = /\[Doc:([^|\]]+)\|([^\]]+)\]/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = citationRegex.exec(text)) !== null) {
      const matchIndex = match.index;
      
      // Texto antes del match
      if (matchIndex > lastIndex) {
        const textSegment = text.slice(lastIndex, matchIndex);
        parts.push(renderTextWithFormatting(textSegment));
      }

      const docId = match[1];
      const fileName = match[2];

      parts.push(
        <button
          key={`cit-${matchIndex}`}
          onClick={() => handleCitationClick(docId, fileName)}
          className="citation-badge"
          title={`Ver expediente: ${fileName}`}
        >
          <FileText size={11} style={{ marginRight: '4px' }} />
          {fileName.length > 25 ? `${fileName.slice(0, 22)}...` : fileName}
        </button>
      );

      lastIndex = citationRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(renderTextWithFormatting(text.slice(lastIndex)));
    }

    return (
      <div style={{ lineHeight: '1.6', fontSize: '0.94rem' }}>
        {parts.map((p, idx) => <React.Fragment key={idx}>{p}</React.Fragment>)}
      </div>
    );
  };

  // Formateador de negritas dentro de segmentos de texto
  const renderTextWithFormatting = (textSegment) => {
    const boldRegex = /\*\*([^*]+)\*\*/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = boldRegex.exec(textSegment)) !== null) {
      const matchIndex = match.index;
      if (matchIndex > lastIndex) {
        parts.push(textSegment.slice(lastIndex, matchIndex));
      }
      parts.push(<strong key={`b-${matchIndex}`} style={{ color: 'var(--text-main)', fontWeight: 700 }}>{match[1]}</strong>);
      lastIndex = boldRegex.lastIndex;
    }

    if (lastIndex < textSegment.length) {
      parts.push(textSegment.slice(lastIndex));
    }

    return parts.length > 0 ? parts : textSegment;
  };

  return (
    <div className="chat-layout">
      {/* Overlay de Carga para abrir visor */}
      {fetchingDoc && (
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(3, 7, 18, 0.7)',
          backdropFilter: 'blur(6px)',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '12px',
          borderRadius: 'var(--border-radius)'
        }}>
          <Loader size={36} color="var(--color-primary)" className="loading-spin" />
          <span style={{ fontSize: '0.9rem', color: 'var(--text-main)', fontWeight: 600 }}>
            Recuperando expediente ambiental completo...
          </span>
        </div>
      )}

      {/* Barra de Filtros Premium */}
      <div className="chat-filters-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-primary)', marginRight: '12px' }}>
          <Filter size={18} />
          <span style={{ fontWeight: 700, fontSize: '0.9rem', textTransform: 'uppercase' }}>Filtros de Chat</span>
        </div>

        {/* Sector */}
        <div className="chat-filter-item">
          <label className="chat-filter-label">Sector</label>
          <select 
            className="chat-filter-select"
            value={selectedSector}
            onChange={(e) => setSelectedSector(e.target.value)}
          >
            <option value="TODOS">TODOS LOS SECTORES</option>
            {sectors.map((s, idx) => (
              <option key={idx} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Empresa */}
        <div className="chat-filter-item">
          <label className="chat-filter-label">Empresa / Interesado</label>
          <select 
            className="chat-filter-select"
            value={selectedCompany}
            onChange={(e) => setSelectedCompany(e.target.value)}
          >
            <option value="TODAS">TODAS LAS EMPRESAS</option>
            {companies.map((c, idx) => (
              <option key={idx} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* Territorio */}
        <div className="chat-filter-item">
          <label className="chat-filter-label">Territorio (Región / CAR)</label>
          <select 
            className="chat-filter-select"
            value={selectedTerritory}
            onChange={(e) => setSelectedTerritory(e.target.value)}
          >
            <option value="TODAS">TODAS LAS REGIONES</option>
            {territories.map((t, idx) => (
              <option key={idx} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {/* Limpiar Filtros */}
        <button 
          className="btn btn-secondary" 
          style={{ padding: '6px 14px', fontSize: '0.8rem', height: '34px', alignSelf: 'flex-end', marginLeft: 'auto' }}
          onClick={() => {
            setSelectedSector('TODOS');
            setSelectedCompany('TODAS');
            setSelectedTerritory('TODAS');
          }}
        >
          Limpiar Filtros
        </button>
      </div>

      {/* Panel de Mensajes */}
      <div className="chat-messages-container">
        {messages.map((msg) => (
          <div 
            key={msg.id} 
            className={`chat-msg ${msg.role === 'user' ? 'chat-msg-user' : 'chat-msg-ai'}`}
          >
            <div className={`chat-msg-avatar ${msg.role === 'user' ? 'chat-msg-avatar-user' : 'chat-msg-avatar-ai'}`}>
              {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
            </div>

            <div className="chat-msg-content">
              {renderMessageContent(msg.content)}

              {/* Citaciones en el pie de página del mensaje de la IA */}
              {msg.role === 'assistant' && msg.citations && msg.citations.length > 0 && (
                <div className="chat-citation-footer">
                  <span className="citation-block-title">Fuentes y Documentos Consultados:</span>
                  {msg.citations.map((cit, index) => (
                    <button
                      key={index}
                      onClick={() => handleCitationClick(cit.id, cit.fileName)}
                      className="citation-badge"
                      style={{ background: 'rgba(67, 233, 123, 0.08)', borderColor: 'rgba(67, 233, 123, 0.25)', color: '#43e97b' }}
                    >
                      <FileText size={10} style={{ marginRight: '4px' }} />
                      {cit.fileName}
                    </button>
                  ))}
                </div>
              )}

              {/* Metadatos de IA de Vertex AI / Gemini */}
              {msg.role === 'assistant' && msg.iaMetadata && (
                <div style={{ 
                  display: 'flex', 
                  gap: '12px', 
                  fontSize: '0.7rem', 
                  color: 'var(--text-muted)', 
                  marginTop: '8px',
                  alignItems: 'center' 
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Cpu size={10} />
                    Modelo: {msg.iaMetadata.modelUsed}
                  </span>
                  <span>•</span>
                  <span>Tiempo: {(msg.iaMetadata.durationMs / 1000).toFixed(2)}s</span>
                  {msg.iaMetadata.tokens && (
                    <>
                      <span>•</span>
                      <span>Tokens: {msg.iaMetadata.tokens.totalTokenCount}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Indicador de carga / Pensando... */}
        {loading && (
          <div className="chat-msg chat-msg-ai">
            <div className="chat-msg-avatar chat-msg-avatar-ai">
              <Bot size={16} />
            </div>
            <div className="chat-msg-content" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="loading-spin" style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid var(--color-success)', borderTopColor: 'transparent', borderRadius: '50%' }}></span>
              <span style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>Anla-Chat está analizando el corpus en base a tus filtros...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Formulario de Entrada */}
      <form onSubmit={handleSend} className="chat-input-container">
        <button
          type="button"
          onClick={clearChat}
          className="btn btn-secondary"
          title="Reiniciar chat"
          style={{ width: '48px', height: '48px', padding: 0 }}
        >
          <Trash2 size={18} color="var(--color-error)" />
        </button>

        <input
          type="text"
          className="chat-input-input"
          placeholder="Ej: ¿Cuáles son las resoluciones aplicadas a Cerrejón por calidad del agua en La Guajira?"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
        />

        <button 
          type="submit" 
          className="btn btn-primary" 
          style={{ width: '48px', height: '48px', padding: 0 }}
          disabled={loading || !input.trim()}
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}
