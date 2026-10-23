import { useState } from 'react';
import type { CorrectionRequestDto, CorrectionRequestStatus } from '@rheinraum/shared';
import { api, qs } from '../api';
import { useLoad } from '../hooks';
import { Badge, Button, Empty, Field, Modal, Notice, PageHeader } from '../components';
import { fmtDateTime, fmtTime } from '../format';

const STATUS: Record<CorrectionRequestStatus, { label: string; tone: 'warning' | 'success' | 'danger' }> = {
  pending: { label: 'Offen', tone: 'warning' },
  approved: { label: 'Genehmigt', tone: 'success' },
  rejected: { label: 'Abgelehnt', tone: 'danger' },
};

export function CorrectionRequestsPage() {
  const [status, setStatus] = useState<string>('pending');
  const [active, setActive] = useState<{ req: CorrectionRequestDto; action: 'approve' | 'reject' } | null>(null);
  const { data, error, reload } = useLoad(
    () => api.get<{ requests: CorrectionRequestDto[] }>(`/api/admin/correction-requests${qs({ status })}`).then((r) => r.requests),
    [status],
  );

  return (
    <div>
      <PageHeader title="Korrekturanfragen">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="pending">Offen</option>
          <option value="approved">Genehmigt</option>
          <option value="rejected">Abgelehnt</option>
          <option value="">Alle</option>
        </select>
      </PageHeader>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Eingang</th>
              <th>Mitarbeiter</th>
              <th>Baustelle</th>
              <th>Gewünschte Zeit</th>
              <th>Begründung</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((r) => (
              <tr key={r.id}>
                <td className="small">{fmtDateTime(r.createdAt)}</td>
                <td>{r.userName}</td>
                <td>{r.siteName}</td>
                <td>
                  {fmtDateTime(r.requestedStart)} – {r.requestedEnd ? fmtTime(r.requestedEnd) : 'offen'}
                </td>
                <td style={{ maxWidth: 320 }}>
                  {r.reason}
                  {r.reviewNote && <div className="small muted">Vermerk: {r.reviewNote}</div>}
                </td>
                <td>
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                </td>
                <td>
                  {r.status === 'pending' && (
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <Button small variant="success" onClick={() => setActive({ req: r, action: 'approve' })}>
                        Genehmigen
                      </Button>
                      <Button small variant="secondary" onClick={() => setActive({ req: r, action: 'reject' })}>
                        Ablehnen
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.length === 0 && (
          <div style={{ padding: 16 }}>
            <Empty>Keine Anfragen.</Empty>
          </div>
        )}
      </div>
      {active && (
        <DecisionModal
          {...active}
          onClose={() => setActive(null)}
          onDone={() => {
            setActive(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function DecisionModal({ req, action, onClose, onDone }: { req: CorrectionRequestDto; action: 'approve' | 'reject'; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const submit = async () => {
    try {
      await api.post(`/api/admin/correction-requests/${req.id}/${action}`, note ? { note } : {});
      onDone();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };
  return (
    <Modal title={action === 'approve' ? 'Anfrage genehmigen' : 'Anfrage ablehnen'} onClose={onClose}>
      <p>
        <strong>{req.userName}</strong> · {req.siteName} · {fmtDateTime(req.requestedStart)}
        {req.requestedEnd ? ` – ${fmtTime(req.requestedEnd)}` : ''}
      </p>
      <p className="muted">{req.reason}</p>
      {action === 'approve' && (
        <Notice tone="info">Es wird eine manuell erfasste Arbeitszeit angelegt bzw. korrigiert. Der Vorgang wird in der Änderungshistorie protokolliert.</Notice>
      )}
      <Field label={action === 'approve' ? 'Vermerk (optional)' : 'Begründung der Ablehnung (Pflicht)'}>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {msg && <Notice tone="danger">{msg}</Notice>}
      <div className="row">
        <Button variant={action === 'approve' ? 'success' : 'danger'} onClick={submit} disabled={action === 'reject' && note.trim().length < 3}>
          {action === 'approve' ? 'Genehmigen' : 'Ablehnen'}
        </Button>
      </div>
    </Modal>
  );
}
