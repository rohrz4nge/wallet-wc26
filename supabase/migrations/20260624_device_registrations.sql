create table if not exists device_registrations (
  device_library_identifier text not null,
  push_token                 text not null,
  serial_number              text not null,
  created_at                 timestamptz not null default now(),
  primary key (device_library_identifier, serial_number)
);

create index if not exists idx_device_reg_serial on device_registrations (serial_number);
