import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  /** Primary trading archetype chosen during Create Account onboarding. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  framework: string | null;

  /** Never returned by mappers or /auth/me. Loaded explicitly for login. */
  @Column({ type: 'varchar', length: 255, select: false })
  passwordHash: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
