export type ReferenceEnvironmentIdentity = Readonly<{
  id: string;
  host: Readonly<{
    operatingSystemVersion: string;
    buildVersion: string;
    kernelVersion: string;
    architecture: string;
    cpuModel: string;
    logicalCpuCount: number;
    memoryMiB: number;
    minimumFreeStorageMiB: number;
  }>;
  docker: Readonly<{
    desktopVersion: string;
    engineVersion: string;
    apiVersion: string;
    operatingSystem: string;
    architecture: string;
    kernelVersion: string;
    minimumCpuCount: number;
    minimumMemoryMiB: number;
  }>;
}>;

export type ReferenceIdentityObservation = Readonly<{
  schemaVersion: 1;
  environmentId: string;
  host: Readonly<{
    operatingSystemVersion: string;
    buildVersion: string;
    kernelVersion: string;
    architecture: string;
    cpuModel: string;
    logicalCpuCount: number;
    memoryMiB: number;
    freeStorageMiB: number;
  }>;
  docker: Readonly<{
    desktopVersion: string;
    engineVersion: string;
    apiVersion: string;
    operatingSystem: string;
    architecture: string;
    kernelVersion: string;
    cpuCount: number;
    memoryMiB: number;
  }>;
}>;

export function referenceIdentityAccepted(
  reference: ReferenceEnvironmentIdentity,
  observed: ReferenceIdentityObservation,
): boolean {
  return observed.environmentId === reference.id &&
    observed.host.operatingSystemVersion === reference.host.operatingSystemVersion &&
    observed.host.buildVersion === reference.host.buildVersion &&
    observed.host.kernelVersion === reference.host.kernelVersion &&
    observed.host.architecture === reference.host.architecture &&
    observed.host.cpuModel === reference.host.cpuModel &&
    observed.host.logicalCpuCount === reference.host.logicalCpuCount &&
    observed.host.memoryMiB === reference.host.memoryMiB &&
    observed.host.freeStorageMiB >= reference.host.minimumFreeStorageMiB &&
    observed.docker.desktopVersion === reference.docker.desktopVersion &&
    observed.docker.engineVersion === reference.docker.engineVersion &&
    observed.docker.apiVersion === reference.docker.apiVersion &&
    observed.docker.operatingSystem === reference.docker.operatingSystem &&
    observed.docker.architecture === reference.docker.architecture &&
    observed.docker.kernelVersion === reference.docker.kernelVersion &&
    observed.docker.cpuCount >= reference.docker.minimumCpuCount &&
    observed.docker.memoryMiB >= reference.docker.minimumMemoryMiB;
}
