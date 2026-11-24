import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, Relation, Unique } from 'typeorm';
import { Uuid } from './base';

@Entity('countries')
export class Country {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  code!: string;

  @Column()
  nameAr!: string;

  @Column()
  nameEn!: string;

  @OneToMany(() => Governorate, (g) => g.country)
  governorates?: Relation<Governorate[]>;
}

@Entity('governorates')
@Unique(['countryId', 'nameEn'])
export class Governorate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Uuid()
  countryId!: string;

  @ManyToOne(() => Country)
  @JoinColumn({ name: 'country_id' })
  country?: Relation<Country>;

  @Column()
  nameAr!: string;

  @Column()
  nameEn!: string;

  @OneToMany(() => City, (c) => c.governorate)
  cities?: Relation<City[]>;
}

@Entity('cities')
@Unique(['governorateId', 'nameEn'])
export class City {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Uuid()
  governorateId!: string;

  @ManyToOne(() => Governorate)
  @JoinColumn({ name: 'governorate_id' })
  governorate?: Relation<Governorate>;

  @Column()
  nameAr!: string;

  @Column()
  nameEn!: string;

  @OneToMany(() => Area, (a) => a.city)
  areas?: Relation<Area[]>;
}

@Entity('areas')
@Unique(['cityId', 'nameEn'])
export class Area {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Uuid()
  cityId!: string;

  @ManyToOne(() => City)
  @JoinColumn({ name: 'city_id' })
  city?: Relation<City>;

  @Column()
  nameAr!: string;

  @Column()
  nameEn!: string;
}
