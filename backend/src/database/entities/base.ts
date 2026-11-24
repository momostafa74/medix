import { Column, ColumnOptions, CreateDateColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Postgres NUMERIC comes back as string; convert to JS number at the edge. */
export const decimalTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? v : parseFloat(v)),
};

export function Money(options: ColumnOptions = {}) {
  return Column({ type: 'numeric', precision: 12, scale: 2, transformer: decimalTransformer, ...options });
}

export function Uuid(options: ColumnOptions = {}) {
  return Column({ type: 'uuid', ...options });
}

export function Tstz(options: ColumnOptions = {}) {
  return Column({ type: 'timestamptz', ...options });
}

export abstract class BaseEntityWithId {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

export abstract class TimestampedEntity extends BaseEntityWithId {
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
