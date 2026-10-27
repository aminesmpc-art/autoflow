import { bindProviderKeepalive } from '../../studio-extension/src/background/service-worker';
import { ProviderKeepalive } from './providerKeepalive';
import './social/worker';

bindProviderKeepalive(new ProviderKeepalive());
