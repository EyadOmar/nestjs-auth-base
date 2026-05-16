import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  constructor() {}

  @Get('health')
  checkHealth(): string {
    return 'We are Healthy';
  }
}
