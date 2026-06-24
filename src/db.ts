import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_KEY ?? "",
);

export interface DeviceRegistration {
  device_library_identifier: string;
  push_token: string;
  serial_number: string;
  created_at?: string;
}

export async function registerDevice(reg: Omit<DeviceRegistration, "created_at">): Promise<void> {
  const { error } = await supabase
    .from("device_registrations")
    .upsert(reg, { onConflict: "device_library_identifier,serial_number" });
  if (error) throw error;
}

export async function unregisterDevice(
  deviceLibraryIdentifier: string,
  serialNumber: string,
): Promise<void> {
  const { error } = await supabase
    .from("device_registrations")
    .delete()
    .eq("device_library_identifier", deviceLibraryIdentifier)
    .eq("serial_number", serialNumber);
  if (error) throw error;
}

export async function getRegistrationsForSerial(serialNumber: string): Promise<DeviceRegistration[]> {
  const { data, error } = await supabase
    .from("device_registrations")
    .select("*")
    .eq("serial_number", serialNumber);
  if (error) throw error;
  return (data ?? []) as DeviceRegistration[];
}

export async function getAllPushTokens(): Promise<string[]> {
  const { data, error } = await supabase
    .from("device_registrations")
    .select("push_token");
  if (error) { console.error("[db] getAllPushTokens failed:", error); return []; }
  return (data ?? []).map((r) => (r as { push_token: string }).push_token);
}

export async function getSerialNumbersForDevice(
  deviceLibraryIdentifier: string,
  passTypeIdentifier: string,
  passesUpdatedSince?: string,
): Promise<string[]> {
  let q = supabase
    .from("device_registrations")
    .select("serial_number")
    .eq("device_library_identifier", deviceLibraryIdentifier);
  if (passesUpdatedSince) q = q.gte("created_at", passesUpdatedSince);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => (r as { serial_number: string }).serial_number);
}
