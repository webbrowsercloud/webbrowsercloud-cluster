import { CoreV1Api, KubeConfig } from '@kubernetes/client-node';

export const K8S_CLIENT = 'K8S_CLIENT';

export const K8sClientProvider = {
  provide: K8S_CLIENT,
  useFactory: (): CoreV1Api => {
    const kubeClient = new KubeConfig();
    kubeClient.loadFromDefault();

    return kubeClient.makeApiClient(CoreV1Api);
  },
};
