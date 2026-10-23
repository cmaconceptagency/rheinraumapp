import {
  breakHint,
  computeSessionTotals,
  type BreakDto,
  type CorrectionRequestDto,
  type PhotoDto,
  type ReportDto,
  type SickNoteDto,
  type SiteDto,
  type UserDto,
  type WorkSessionDto,
} from '@rheinraum/shared';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const iso = (v: Date | string | null | undefined) => (v == null ? null : new Date(v).toISOString());

export function toUser(r: Row): UserDto {
  return {
    id: r.id,
    email: r.email,
    firstName: r.first_name,
    lastName: r.last_name,
    role: r.role,
    hrAccess: r.hr_access,
    active: r.active,
    phone: r.phone,
    personnelNo: r.personnel_no,
    invitePending: r.password_hash == null,
    ...(r.company_name ? { companyName: r.company_name } : {}),
  };
}

export function toSite(r: Row): SiteDto {
  return {
    id: r.id,
    name: r.name,
    street: r.street,
    zip: r.zip,
    city: r.city,
    lat: r.lat,
    lng: r.lng,
    radiusM: r.radius_m,
    contactName: r.contact_name,
    contactPhone: r.contact_phone,
    notes: r.notes,
    active: r.active,
  };
}

export function toBreak(r: Row): BreakDto {
  return { id: r.id, startedAt: iso(r.started_at)!, endedAt: iso(r.ended_at) };
}

export function toSession(r: Row, breaks: BreakDto[], now = new Date()): WorkSessionDto {
  const startedAt = iso(r.started_at)!;
  const endedAt = iso(r.ended_at);
  const totals = computeSessionTotals({ startedAt, endedAt }, breaks, now);
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name ?? undefined,
    siteId: r.site_id,
    siteName: r.site_name ?? undefined,
    startedAt,
    endedAt,
    verification: r.verification,
    source: r.source,
    startLocation: r.start_check ?? null,
    endDistanceM: r.end_distance_m,
    breaks,
    totals,
    breakHint: endedAt ? breakHint(totals) : null,
    note: r.note,
    reviewedAt: iso(r.reviewed_at),
    reviewedByName: r.reviewed_by_name ?? null,
  };
}

export function toCorrectionRequest(r: Row): CorrectionRequestDto {
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name ?? undefined,
    siteId: r.site_id,
    siteName: r.site_name ?? undefined,
    sessionId: r.session_id,
    requestedStart: iso(r.requested_start)!,
    requestedEnd: iso(r.requested_end),
    reason: r.reason,
    status: r.status,
    reviewNote: r.review_note,
    createdAt: iso(r.created_at)!,
  };
}

export function toPhoto(r: Row): PhotoDto {
  return {
    id: r.id,
    reportId: r.report_id,
    mime: r.mime,
    sizeBytes: r.size_bytes,
    createdAt: iso(r.created_at)!,
    url: `/api/photos/${r.id}/file`,
  };
}

export function toReport(r: Row, photos: PhotoDto[]): ReportDto {
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name ?? undefined,
    siteId: r.site_id,
    siteName: r.site_name ?? undefined,
    reportDate: r.report_date,
    workDone: r.work_done,
    remarks: r.remarks,
    photos,
    createdAt: iso(r.created_at)!,
  };
}

export function toSickNote(r: Row): SickNoteDto {
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name ?? undefined,
    startDate: r.start_date,
    expectedEndDate: r.expected_end_date,
    certificateProvided: r.certificate_provided,
    createdAt: iso(r.created_at)!,
  };
}
