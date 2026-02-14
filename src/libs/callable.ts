export default function Callable<T extends new (...args: any[]) => any>(
  classname: T
) {
  function apply(target: T, _: any, argumentsList: any[]): InstanceType<T> {
    return new target(...argumentsList);
  }
  return new Proxy(classname, { apply }) as T &
    ((...args: ConstructorParameters<T>) => InstanceType<T>);
}
