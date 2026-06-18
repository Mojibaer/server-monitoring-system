import { ZipkinExporter } from "@opentelemetry/exporter-zipkin";
import { GrpcInstrumentation } from "@opentelemetry/instrumentation-grpc";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { trace } from "@opentelemetry/api";


export const tracer = trace.getTracer("server-monitoring-backend");

const zipkinEndpoint =
  process.env.OTEL_EXPORTER_ZIPKIN_ENDPOINT ?? "http://localhost:9411/api/v2/spans";

const serviceName = process.env.OTEL_SERVICE_NAME ?? "monitoring-backend";

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName
  }),
  traceExporter: new ZipkinExporter({
    url: zipkinEndpoint
  }),
  instrumentations: [new HttpInstrumentation(), new GrpcInstrumentation()]
});

sdk.start();

export async function shutdownTracing() {
  await sdk.shutdown();
}