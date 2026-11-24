import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Repository } from 'typeorm';
import { Area, City, Country, Governorate } from '../../database/entities';
import { Public, RequirePermissions } from '../../common/decorators';
import { P } from '../../common/permissions';
import { CachePublic, InvalidatesCache } from '../../common/cache/http-cache.interceptor';

class NameDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) nameAr!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) nameEn!: string;
}
class CreateGovernorateDto extends NameDto {
  @ApiProperty() @IsUUID() countryId!: string;
}
class CreateCityDto extends NameDto {
  @ApiProperty() @IsUUID() governorateId!: string;
}
class CreateAreaDto extends NameDto {
  @ApiProperty() @IsUUID() cityId!: string;
}
class ParentQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() parentId?: string;
}

/** Country → Governorate → City → Area. Map coordinates live on branches, so nothing depends on a maps vendor. */
@ApiTags('Locations')
@Controller('locations')
export class LocationsController {
  constructor(
    @InjectRepository(Country) private countries: Repository<Country>,
    @InjectRepository(Governorate) private govs: Repository<Governorate>,
    @InjectRepository(City) private cities: Repository<City>,
    @InjectRepository(Area) private areas: Repository<Area>,
  ) {}

  @Public()
  @CachePublic(600, 'locations')
  @Get('countries')
  listCountries() {
    return this.countries.find({ order: { nameAr: 'ASC' } });
  }

  @Public()
  @CachePublic(600, 'locations')
  @Get('governorates')
  listGovs(@Query() q: ParentQuery) {
    return this.govs.find({ where: q.parentId ? { countryId: q.parentId } : {}, order: { nameAr: 'ASC' } });
  }

  @Public()
  @CachePublic(600, 'locations')
  @Get('cities')
  listCities(@Query() q: ParentQuery) {
    return this.cities.find({ where: q.parentId ? { governorateId: q.parentId } : {}, order: { nameAr: 'ASC' } });
  }

  @Public()
  @CachePublic(600, 'locations')
  @Get('areas')
  listAreas(@Query() q: ParentQuery) {
    return this.areas.find({ where: q.parentId ? { cityId: q.parentId } : {}, order: { nameAr: 'ASC' } });
  }

  /** Whole tree for filters (small dataset; cache-friendly). */
  @Public()
  @CachePublic(600, 'locations')
  @Get('tree')
  tree() {
    return this.govs.find({ relations: { cities: { areas: true } }, order: { nameAr: 'ASC' } });
  }

  @ApiBearerAuth()
  @Post('governorates')
  @InvalidatesCache('locations')
  @RequirePermissions(P.LOCATIONS_MANAGE)
  createGov(@Body() dto: CreateGovernorateDto) {
    return this.govs.save(this.govs.create(dto));
  }

  @ApiBearerAuth()
  @Post('cities')
  @InvalidatesCache('locations')
  @RequirePermissions(P.LOCATIONS_MANAGE)
  createCity(@Body() dto: CreateCityDto) {
    return this.cities.save(this.cities.create(dto));
  }

  @ApiBearerAuth()
  @Post('areas')
  @InvalidatesCache('locations')
  @RequirePermissions(P.LOCATIONS_MANAGE)
  createArea(@Body() dto: CreateAreaDto) {
    return this.areas.save(this.areas.create(dto));
  }

  @ApiBearerAuth()
  @Patch('areas/:id')
  @InvalidatesCache('locations')
  @RequirePermissions(P.LOCATIONS_MANAGE)
  async updateArea(@Param('id', ParseUUIDPipe) id: string, @Body() dto: NameDto) {
    await this.areas.update(id, { nameAr: dto.nameAr, nameEn: dto.nameEn });
    return this.areas.findOneBy({ id });
  }
}
