import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { HashService } from './hash.service';

@Global()
@Module({
  providers: [CryptoService, HashService],
  exports: [CryptoService, HashService],
})
export class CryptoModule {}
