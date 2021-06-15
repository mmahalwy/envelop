import { defaultFieldResolver, GraphQLFieldResolver, GraphQLSchema, isIntrospectionType, isObjectType } from 'graphql';
import { AfterResolverPayload, OnResolverCalledHooks } from 'packages/types/src';

export const trackedSchemaSymbol = Symbol('TRACKED_SCHEMA');
export const resolversHooksSymbol = Symbol('RESOLVERS_HOOKS');

export function prepareTracedSchema(schema: GraphQLSchema | null | undefined): void {
  if (!schema || schema[trackedSchemaSymbol]) {
    return;
  }

  schema[trackedSchemaSymbol] = true;
  const entries = Object.values(schema.getTypeMap());

  for (const type of entries) {
    if (!isIntrospectionType(type) && isObjectType(type)) {
      const fields = Object.values(type.getFields());

      for (const field of fields) {
        const originalFn: GraphQLFieldResolver<any, any> = field.resolve || defaultFieldResolver;

        field.resolve = async (root, args, context, info) => {
          if (context && context[resolversHooksSymbol]) {
            const hooks: OnResolverCalledHooks[] = context[resolversHooksSymbol];
            const afterCalls: Array<(p: AfterResolverPayload) => void> = [];

            for (const hook of hooks) {
              const afterFn = await hook({ root, args, context, info });
              afterFn && afterCalls.push(afterFn);
            }

            try {
              let result = await originalFn(root, args, context, info);

              for (const afterFn of afterCalls) {
                afterFn({
                  result,
                  setResult: newResult => {
                    result = newResult;
                  },
                });
              }

              return result;
            } catch (e) {
              let resultErr = e;

              for (const afterFn of afterCalls) {
                afterFn({
                  result: resultErr,
                  setResult: newResult => {
                    resultErr = newResult;
                  },
                });
              }

              throw resultErr;
            }
          } else {
            return originalFn(root, args, context, info);
          }
        };
      }
    }
  }
}