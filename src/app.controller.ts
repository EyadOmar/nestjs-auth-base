import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class AppController {
  constructor() {}

  @Get('health')
  @Public()
  checkHealth(): string {
    return 'We are Healthy';
  }
}
