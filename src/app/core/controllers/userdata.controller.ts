import {
  Controller,
  Get,
  NotFoundException,
  Param,
  InternalServerErrorException,
  Delete,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import fs from 'fs/promises';
import path from 'path';

@Controller('userdata')
export class UserDataController {
  constructor(private readonly configService: ConfigService) {}

  @Get(':id')
  async get(@Param('id') id: string): Promise<any> {
    try {
      const stat = await fs.stat(
        path.join(this.configService.get('USER_DATA_DIR', '/userdata'), id),
      );

      return {
        id,
        createdAt: stat.birthtime,
        updatedAt: stat.mtime,
      };
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new NotFoundException();
      }

      throw new InternalServerErrorException();
    }
  }

  @Get(':id/download')
  async download(@Param('id') id: string): Promise<any> {
    throw new NotFoundException();
  }

  @HttpCode(204)
  @Delete(':id')
  async delete(@Param('id') id: string): Promise<void> {
    try {
      await fs.rmdir(
        path.join(this.configService.get('USER_DATA_DIR', '/userdata'), id),
      );
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new BadRequestException();
      }

      throw new InternalServerErrorException();
    }
  }
}
